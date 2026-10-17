import { NextResponse } from 'next/server';
import { saveTssRenewal } from '@/lib/mongodb-utils';
import { sendEmailDirect } from '@/lib/email-queue';
import { getRequestMeta, lookupGeo, maskIp, isValidSessionId, markConversion, isIgnoredRequest, visitorLog, getClientIp } from '@/lib/visitors';
import type { GeoInfo } from '@/lib/visitors';
// CHANGE: 2026-10-17 — per-IP rate limit (ported from the public repo, which added it on
// 2026-10-08). This route writes to the production `tss_renewals` collection AND sends a real
// internal email, but had no limiter at all.
import { createRateLimiter } from '@/lib/rate-limit';

const rateLimiter = createRateLimiter(Number(process.env.TSS_RENEWAL_RATE_LIMIT || 20), 60_000);

function sanitize(str: string) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().substring(0, 500);
}

export async function POST(request: Request) {
  // CHANGE: 2026-10-17 — rate limit BEFORE parsing the body.
  const limit = rateLimiter.check(getClientIp(request));
  if (limit.limited) {
    return NextResponse.json(
      { error: 'Too many requests, please slow down.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }
  try {
    const rawData = await request.json();

    const data = {
      serialNumber: sanitize(rawData.serialNumber),
      name: sanitize(rawData.name),
      email: sanitize(rawData.email),
      source: sanitize(rawData.source) || 'website'
    };

    if (!data.serialNumber || !data.name || !data.email) {
      return NextResponse.json({ error: 'Serial number, name, and email are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    // Passive enrichment: IP, UA, geo (cache-first) + browsing session id.
    const meta = getRequestMeta(request);

    // CHANGE: 2026-10-17 — ignore-list gate (ported from the public repo, added there 2026-09-30).
    // Writes to the PRODUCTION `tss_renewals` collection and sends a REAL email; without this a
    // dev/test request created genuine renewal records and real mail.
    if (isIgnoredRequest(request)) {
      visitorLog('warn', 'ignored ip — renewal not saved, no email sent', { ip: maskIp(meta.ip) });
      return NextResponse.json({ message: 'TSS renewal request received', saved: false, ignored: true });
    }

    const sessionId = isValidSessionId(rawData.sessionId) ? String(rawData.sessionId) : '';
    let geo: GeoInfo | null = null;
    if (meta.secGpc !== true) {
      const lookup = await lookupGeo(meta.ip);
      geo = lookup.geo;
    }
    if (sessionId) await markConversion(sessionId);

    const enriched = {
      ...data,
      ip: meta.secGpc ? undefined : meta.ip,
      ipMasked: maskIp(meta.ip),
      userAgent: meta.userAgent || undefined,
      geo,
      ...(sessionId ? { sessionId } : {}),
    };

    const result = await saveTssRenewal(enriched);
    const renewalId = result.insertedId.toString();

    // Send the internal TSS-renewal email copy DIRECTLY (inline). Recipients are
    // opt-in via the "TSS Renewal" receiver option in /admin/email-config — no
    // receiver configured means no email (the request is still saved).
    const send = await sendEmailDirect({
      jobKey: `tss-renewal-${renewalId}`,
      formType: 'tss-renewal',
      destination: 'tss-renewal',
      submission: {
        name: data.name,
        email: data.email,
        contact: '',
        service: `TSS Serial No: ${data.serialNumber}`,
        description: `TSS renewal requested from ${data.source || 'website'}`,
        formType: 'tss-renewal',
        destination: 'tss-renewal',
        ip: enriched.ip,
        ipMasked: enriched.ipMasked,
        userAgent: enriched.userAgent,
        geo,
        ...(sessionId ? { sessionId } : {}),
      },
    });

    return NextResponse.json({
      message: 'Renewal request submitted successfully',
      emailSent: send.sent,
    });
  } catch (error) {
    console.error('TSS Renewal API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
