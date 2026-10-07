import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// CHANGE: 2026-10-06 — SP-4 security hardening: the admin guard, rate limiter and
// content-type gate were living in proxy.ts, which Next 15 NEVER reads (frontend AGENTS
// §10) — every /api/admin/* route on this deployment ran unauthenticated. The ported
// logic lives in ./lib/admin-guard.ts (next/*-free, house pattern) so it is unit-tested
// by scripts/admin-guard-test.mjs under plain node.
import {
  ADMIN_GUARD_EXEMPT,
  isAdminPath,
  isAdminRequest,
  checkRateLimit,
  isUnsupportedWrite,
} from './lib/admin-guard.ts';

// Origins allowed to call the public API routes from another host.
// The cPanel-hosted static frontend origin goes here at deploy time, e.g.
// FRONTEND_ALLOWED_ORIGINS=https://sarvadnya.in,https://www.sarvadnyainfotech.com
const FRONTEND_ALLOWED_ORIGINS = ('https://en.sarvadnyainfotech.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Same-site default so the Vercel deployment can always call itself.
const DEFAULT_ALLOWED_ORIGINS = ['https://sarvadnya-infotech.vercel.app'];

const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...FRONTEND_ALLOWED_ORIGINS]);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'Content-Type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Localhost is allowed for local preview testing of the static export
// (e.g. `npx serve out`). Any port counts as local.
function isLocalhost(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const start = performance.now();
  const { pathname } = request.nextUrl;

  // --- Admin guard (ported from the dormant proxy.ts — see lib/admin-guard.ts) ---
  // 401 for unauthenticated /api/admin/*; the exempt login/email-process paths pass
  // (each has its own auth story, documented in the guard module). Admin PAGES fall
  // through: the AdminLayout client-side session check redirects to /admin/login —
  // proxy.ts semantics preserved.
  if (isAdminPath(pathname) && !ADMIN_GUARD_EXEMPT.has(pathname) && !isAdminRequest(request.headers)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized Access' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Robots-Tag': 'noindex, nofollow', // noindex layer 2 (owner: never index this deployment)
          },
        }
      );
    }
  }

  // --- Rate limiting (proxy port; /api/admin/login now included — ruling 3) ---
  if ((pathname.startsWith('/api/') && !isAdminPath(pathname)) || pathname === '/api/admin/login') {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'anonymous';
    const rl = checkRateLimit(ip);
    if (rl.limited) {
      return NextResponse.json(
        { error: 'Too many requests, please slow down.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
  }

  // --- Content-Type gate for API writes (proxy port) ---
  if (pathname.startsWith('/api/') && isUnsupportedWrite(request.method, request.headers.get('content-type'))) {
    return NextResponse.json({ error: 'Unsupported Media Type' }, { status: 415 });
  }

  const origin = request.headers.get('origin');
  const allowed = origin !== null && (ALLOWED_ORIGINS.has(origin) || isLocalhost(origin));

  if (request.method === 'OPTIONS') {
    const headers: Record<string, string> = { ...CORS_HEADERS, Vary: 'Origin' };
    if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  // --- Security headers (proxy port) ---
  // X-Robots-Tag — noindex layer 2: this deployment (admin panel) must never be indexed.
  // X-Response-Time is harmless and useful; XFO/nosniff are deliberately NOT duplicated
  // here — next.config.js headers() already applies them to every path (source '/(.*)').
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('X-Response-Time', `${(performance.now() - start).toFixed(1)}ms`);
  if (allowed && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

export const config = {
  // /admin + /api cover the whole admin surface; proxy.ts's matcher extended with the
  // admin paths (SP-4: the old '/api/:path*'-only matcher never touched /admin pages).
  matcher: ['/admin/:path*', '/api/admin/:path*', '/api/:path*'],
};
