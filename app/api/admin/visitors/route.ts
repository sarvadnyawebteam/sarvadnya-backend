import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import {
  getCollection,
  serializeData,
  isValidObjectId,
} from '@/lib/mongodb-utils';
import { isRequestAuthorized } from '@/lib/admin-auth';
import { ensureVisitorIndexes, maskSessionId } from '@/lib/visitors';
import {
  VISITOR_KEY_EXPR,
  HUMAN_MATCH,
  BOT_MATCH,
  MAX_SESSION_REFS,
  visitorKeyOf,
} from '@/lib/visitor-groups';

export const runtime = 'nodejs';

const SORT_KEYS = ['lastSeen', 'firstSeen', 'visitCount', 'pageViews', 'sessionCount'] as const;

// CHANGE: 2026-10-17 — owner: "same visitor marked as multiple visits as separate entry.
// We need to show unique visitor and increment their visit as latest, ensure bots are
// separated."
//
// WHY the panel used to show duplicates: a `visitors` document is ONE SESSION (the client
// keeps a `svd_vid` cookie for a year → a returning browser updates its own doc and the
// visit count grows). But anything that does not keep the cookie mints a fresh session id
// per run, so it becomes a NEW document every time — headless crawlers especially (the live
// data had `13.57.148.235` split across 50 docs and `54.183.149.156` across 46, all with the
// same HeadlessChrome UA and visitCount 1).
//
// FIX (read-side only — NO data migration, the raw session documents are untouched):
// sessions are grouped into UNIQUE VISITORS by the shared IP + device-signature key defined
// in lib/visitor-groups.ts, with visits/page views SUMMED and first/last seen taken from the
// group. `scope=humans` (default) or `scope=bots` splits the two populations; the stat cards
// are always humans-only so crawler noise cannot inflate them.
const VISITOR_KEY = VISITOR_KEY_EXPR;

// Session history is only carried for the detail modal + group delete, so it is bounded.

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
  }

  try {
    await ensureVisitorIndexes();

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20) || 20));
    const country = (url.searchParams.get('country') || '').trim();
    const device = (url.searchParams.get('device') || '').trim();
    const q = (url.searchParams.get('q') || '').trim();
    const scope = url.searchParams.get('scope') === 'bots' ? 'bots' : 'humans';
    const rawSort = url.searchParams.get('sortBy') || 'lastSeen';
    const sortBy = (SORT_KEYS as readonly string[]).includes(rawSort) ? rawSort : 'lastSeen';
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 1 : -1;

    // Per-session match, applied BEFORE the grouping.
    const filter: Record<string, unknown> = { ...(scope === 'bots' ? BOT_MATCH : HUMAN_MATCH) };
    if (country && country !== 'all') filter['geo.country'] = country;
    if (device && device !== 'all') filter['device.type'] = device;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { 'geo.country': rx },
        { 'geo.city': rx },
        { 'geo.region': rx },
        { 'geo.isp': rx },
        { lastPath: rx },
        { ip: rx },
        // CHANGE: 2026-10-17 — device/UA are now searchable so "bot" or "headless"
        // can be typed straight into the search box.
        { userAgent: rx },
        { 'device.browser': rx },
        { 'device.os': rx },
        { 'device.type': rx },
      ];
    }

    const col = await getCollection('visitors');
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [groups, totalAgg, countsAgg, topCountries, deviceBreakdown, botCountAgg] =
      await Promise.all([
        // 1) The unique-visitor page for the current scope + filters. `$sort` BEFORE `$group`
        //    is what makes `$last` mean "most recent session" (and `$first` the oldest).
        col
          .aggregate([
            { $match: filter },
            { $sort: { lastSeen: 1, _id: 1 } },
            {
              $group: {
                _id: VISITOR_KEY,
                firstSeen: { $min: '$firstSeen' },
                lastSeen: { $max: '$lastSeen' },
                visitCount: { $sum: '$visitCount' },
                pageViews: { $sum: '$pageViews' },
                sessionCount: { $sum: 1 },
                latestSessionId: { $last: '$sessionId' },
                entryPath: { $first: '$entryPath' },
                lastPath: { $last: '$lastPath' },
                referrer: { $first: '$referrer' },
                lastReferrer: { $last: '$lastReferrer' },
                geo: { $last: '$geo' },
                device: { $last: '$device' },
                userAgent: { $last: '$userAgent' },
                language: { $last: '$language' },
                screen: { $last: '$screen' },
                lastFormAt: { $last: '$lastFormAt' },
                secGpc: { $last: '$secGpc' },
                gpcRespected: { $last: '$gpcRespected' },
                sectionViews: { $addToSet: { $ifNull: ['$sectionViews', []] } },
                paths: { $push: { $ifNull: ['$paths', []] } },
                sessions: {
                  $push: {
                    _id: '$_id',
                    sessionId: '$sessionId',
                    firstSeen: '$firstSeen',
                    lastSeen: '$lastSeen',
                    visitCount: '$visitCount',
                    pageViews: '$pageViews',
                    lastPath: '$lastPath',
                  },
                },
              },
            },
            {
              $addFields: {
                sessionIds: '$sessions._id',
                sectionViews: {
                  $reduce: {
                    input: '$sectionViews',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                // Sessions are pushed oldest→newest (see the `$sort`), so the concatenated
                // array ends with the most recent activity — keep the newest slice.
                paths: {
                  $slice: [
                    {
                      $reduce: {
                        input: '$paths',
                        initialValue: [],
                        in: { $concatArrays: ['$$value', '$$this'] },
                      },
                    },
                    -80,
                  ],
                },
              },
            },
            { $sort: { [sortBy]: sortDir, lastSeen: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ])
          .toArray(),
        // 2) Unique-visitor total for the current scope + filters (paginates against this).
        col
          .aggregate([{ $match: filter }, { $group: { _id: VISITOR_KEY } }, { $count: 'n' }])
          .toArray(),
        // 3) Headline stats — ALWAYS humans-only, whatever tab is open (owner: bots separated).
        col
          .aggregate([
            { $match: HUMAN_MATCH },
            {
              $group: {
                _id: VISITOR_KEY,
                lastSeen: { $max: '$lastSeen' },
                firstSeen: { $min: '$firstSeen' },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                activeToday: { $sum: { $cond: [{ $gte: ['$lastSeen', dayAgo] }, 1, 0] } },
                activeWeek: { $sum: { $cond: [{ $gte: ['$lastSeen', weekAgo] }, 1, 0] } },
                newToday: { $sum: { $cond: [{ $gte: ['$firstSeen', startOfDay] }, 1, 0] } },
              },
            },
          ])
          .toArray(),
        // 4) Top countries, counted per unique visitor (not per session).
        col
          .aggregate([
            { $match: HUMAN_MATCH },
            { $sort: { lastSeen: 1, _id: 1 } },
            { $group: { _id: VISITOR_KEY, country: { $last: '$geo.country' } } },
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray(),
        // 5) Device breakdown, counted per unique visitor.
        col
          .aggregate([
            { $match: HUMAN_MATCH },
            { $group: { _id: VISITOR_KEY } },
            { $group: { _id: '$_id.type', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray(),
        // 6) Unique bots — drives the tabs' badge.
        col
          .aggregate([{ $match: BOT_MATCH }, { $group: { _id: VISITOR_KEY } }, { $count: 'n' }])
          .toArray(),
      ]);

    const total = totalAgg[0]?.n ?? 0;
    const counts = countsAgg[0] || { total: 0, activeToday: 0, activeWeek: 0, newToday: 0 };
    const botVisitors = botCountAgg[0]?.n ?? 0;

    // CHANGE: 2026-10-17 — map the RAW aggregation rows, then serialize the result.
    // Do NOT `serializeData(groups)` first: the group `_id` is an OBJECT
    // ({ip,type,browser,os}) and serializeData's `data._id.toString()` fallback replaces
    // it with the string "[object Object]", which silently blanked every row's `ip`/key.
    const mapped = groups.map((v: any) => {
      const sessions = Array.isArray(v.sessions) ? v.sessions.slice(-MAX_SESSION_REFS) : [];
      // Newest session first for the modal list.
      const sessionList = sessions
        .slice()
        .sort((a: any, b: any) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
        .map((s: any) => ({
          _id: String(s._id),
          sessionId: maskSessionId(s.sessionId),
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          visitCount: s.visitCount ?? 0,
          pageViews: s.pageViews ?? 0,
          lastPath: s.lastPath || '',
        }));

      return {
        // A unique visitor has no single session `_id`; the composite key identifies the row.
        _id: visitorKeyOf(v),
        visitorKey: visitorKeyOf(v),
        sessionCount: v.sessionCount ?? 0,
        latestSessionId: maskSessionId(v.latestSessionId),
        sessionIds: sessions.map((s: any) => String(s._id)),
        sessions: sessionList,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        visitCount: v.visitCount ?? 0,
        pageViews: v.pageViews ?? 0,
        entryPath: v.entryPath,
        lastPath: v.lastPath,
        referrer: v.referrer || v.lastReferrer || '',
        lastReferrer: v.lastReferrer || '',
        // CHANGE: 2026-08-29 — Return FULL IP (never masked) to the admin panel so the
        // table/detail view show the complete address. Search also covers the raw ip field.
        ip: v._id?.ip || '',
        geo: v.geo ?? null,
        device: v.device ?? null,
        secGpc: Boolean(v.secGpc),
        gpcRespected: Boolean(v.gpcRespected),
        paths: Array.isArray(v.paths) ? v.paths : [],
        sectionViews: Array.isArray(v.sectionViews) ? v.sectionViews.filter(Boolean) : [],
        userAgent: v.userAgent || '',
        language: v.language || '',
        screen: v.screen || '',
        lastFormAt: v.lastFormAt || null,
      };
    });

    return NextResponse.json({
      // Serialise the finished rows (dates -> ISO, any lingering ObjectId -> hex). The row
      // `_id` is already a plain string, so serializeData leaves it untouched.
      visitors: serializeData(mapped),
      scope,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      meta: {
        total: counts.total ?? 0,
        activeToday: counts.activeToday ?? 0,
        activeWeek: counts.activeWeek ?? 0,
        newToday: counts.newToday ?? 0,
        botVisitors,
        topCountries: topCountries.map((t: any) => ({
          country: t._id || 'Unknown',
          count: t.count,
        })),
        deviceBreakdown: deviceBreakdown.map((d: any) => ({
          device: d._id || 'unknown',
          count: d.count,
        })),
      },
    });
  } catch (err) {
    console.error('Failed to fetch visitors:', err);
    return NextResponse.json({ error: 'Failed to fetch visitors' }, { status: 500 });
  }
}

// CHANGE: 2026-10-17 — a row is now a UNIQUE VISITOR (many session docs), so the delete
// path accepts `?ids=a,b,c` (every session `_id` the row was grouped from) and removes them
// in one `deleteMany`. The legacy single `?id=` form is kept for compatibility.
function parseIdList(raw: string): { ok: boolean; ids: ObjectId[]; reason?: string } {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, ids: [], reason: 'No visitor ids supplied' };
  if (parts.length > MAX_SESSION_REFS) {
    return { ok: false, ids: [], reason: `Too many sessions in one request (max ${MAX_SESSION_REFS})` };
  }
  if (!parts.every(isValidObjectId)) {
    return { ok: false, ids: [], reason: 'Invalid visitor id' };
  }
  return { ok: true, ids: parts.map((p) => new ObjectId(p)) };
}

export async function DELETE(request: Request) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const idsParam = params.get('ids');
    const idParam = params.get('id') || '';

    const col = await getCollection('visitors');

    if (idsParam !== null) {
      const parsed = parseIdList(idsParam);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.reason }, { status: 400 });
      }
      const result = await col.deleteMany({ _id: { $in: parsed.ids } });
      if (result.deletedCount === 0) {
        return NextResponse.json({ error: 'Visitor not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, deleted: result.deletedCount });
    }

    if (!isValidObjectId(idParam)) {
      return NextResponse.json({ error: 'Invalid visitor id' }, { status: 400 });
    }
    const result = await col.deleteOne({ _id: new ObjectId(idParam) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Visitor not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Failed to delete visitor:', err);
    return NextResponse.json({ error: 'Failed to delete visitor' }, { status: 500 });
  }
}
