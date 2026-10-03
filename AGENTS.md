# Project Documentation & Architecture 

## Technical Architecture

### 1. Framework & Core Technologies
- **Next.js 16 (React 19):** Utilizing the latest App Router and React Compiler capabilities.
- **Tailwind CSS 4:** For high-performance, utility-first styling.
- **TypeScript:** Strict typing across the codebase for reliability.
- **MongoDB:** Backend data persistence (as seen in `lib/mongodb.ts`).

### 2. Performance Engineering (Optimized for Low-End Systems)
The application implements several advanced optimization strategies to ensure smooth 60fps rendering even on resource-constrained devices:

- **Visibility-Aware Rendering:**
    - Components like `HomeHero`, `CustomerReviews`, and `FAQ` use `IntersectionObserver` to halt animations and transitions when off-screen.
    - **Tab Visibility Management:** The Page Visibility API is used to detect when a user leaves the tab. All animations and timers are paused and "soft reset" upon return to prevent animation stacking and "catch-up" flashes.
    - `content-visibility: auto` is applied globally to skip the rendering of non-visible sections.
- **Computational Efficiency:**
    - **Memoization:** Critical UI components (`Productbar`, `CustomerReviews`, `FAQ`) are wrapped in `React.memo` and use `useCallback` to prevent redundant main-thread work.
    - **Resource Management:** Background scripts (like the `swirl.js` canvas effect) use `Float32Array` for memory-efficient particle management and reduce complexity automatically on mobile devices.
- **Load Timing:**
    - **Lazy Loading:** Non-critical components like `QuickSupportModal` are loaded using `next/dynamic` only when requested.
    - **Image Optimization:** Extensive use of `next/image` with proper `sizes` and `priority` attributes to minimize Layout Shift (CLS).

### 3. Key Components Catalog

| Component | Responsibility | Performance Features |
| :--- | :--- | :--- |
| `HomeHero` | Primary landing content with dynamic slide themes. | `IntersectionObserver` pauses, visibility-aware typing effect. |
| `Productbar` | Apple-style navigation for deep-diving into products. | Memoized icons, `useCallback` click handlers, backdrop-blur. |
| `CustomerReviews` | Displays verified social proof. | Staggered entrance animations, memoized star ratings. |
| `CertifiedPartners` | Showcases network reliability. | Automated Rise-up animations, lazy-loaded partner logos. |
| `FAQ` | Dynamic accordion with keyword search. | `useMemo` for search filtering, partial list rendering (Expandable). |
| `QuickSupportModal` | AI-powered sales consultant chatbot (Ask Sara). | Groq API with local fallback, stop/interrupt, typewriter, voice, tutorials. |
| `ModuleCard` / `ModuleModal` | Modules grid + detail modal (`/modules`). Card action buttons fixed `h-10 whitespace-nowrap` and pinned to card bottom via `mt-auto` for consistent alignment. Modal pricing is hidden behind a "View Price" reveal gated by a simple addition game (`X + Y = ?`) before showing the 2-column Package|Price table. | Data served from MongoDB `modules` collection (seeded by `scripts/seed_modules.mjs`); `lib/modules.ts` holds only the `Module` type. |
| `AddonsPage` (`/addons`) | Searchable catalog of top-20 Tally TDL add-ons. Full-width single-column cards with "Submit Requirement" CTA → `UnifiedContactModal` prefilled `Add-on: <title>` + explicit `destination="addons"`. Cards carry anchor ids (`scroll-mt-28`) so ProductBar deep links (`/addons#slug`) scroll past the sticky search bar. | Static data in `lib/addons.ts` (`Addon { id, title, description }` — no DB/admin). Sticky search via `useMemo` over title+description; memoized `AddonCard`; live result counter. |

### 4. AI Chatbot Architecture (Sara)

| File | Role |
| :--- | :--- |
| `app/api/chat/route.ts` | Server-side API. Calls Groq SDK with multi-key rotation, 25s timeout, bulletproof think-tag cleanup. System prompt defines Sara as a senior sales consultant with full product catalog. |
| `app/components/QuickSupportModal.tsx` | Floating button chat UI. AI API call with local keyword fallback. Stop/interrupt button during typewriter. Input stays focused. 20-40 char chunks at 5-8ms. |
| `lib/sara-topics.ts` | Shared knowledge base. 7 topic trees with follow-ups, `matchTopic()` keyword scorer, `getFallbackResponse()` with 20+ contextual patterns. Used by both Ask Sara and Learn Sara. |
| `app/(site)/learn-sara/page.tsx` | Full-page Sara chatbot. Imports from `lib/sara-topics.ts`. Local keyword matching, no API calls. |

### 5. Chunked Upload System (Vercel Large-Payload Compatibility)

Vercel serverless functions reject request bodies over ~4.5 MB, so all uploads are split into small chunks and reassembled in Vercel Blob.

**Flow:** Files ≤ 3 MB upload in a single `multipart/form-data` POST. Larger files are sliced into 2 MB chunks client-side; each chunk is stored as a temp blob part (`sarvadnya-uploads/_chunks/{uploadId}/part-NNNNN.ext`), and the final chunk streams all parts back into one assembled file server-side, deletes the temp parts, and removes the replaced `oldUrl` blob.

| File | Role |
| :--- | :--- |
| `lib/uploadClient.ts` | Client helper `uploadFileChunked({ file, type, name, oldUrl, endpoint, onProgress })`. Slices large files into 2 MB chunks, sends sequentially with `uploadId`/`chunkIndex`/`totalChunks`, returns `{ url }`. |
| `lib/chunkUpload.ts` | Shared server handler. Single-chunk = direct `put`. Multi-chunk = `put` parts (`allowOverwrite: true`), then on final chunk `list` + sort + stream-concat into `sarvadnya-{type}-{name}-{timestamp}{ext}` via `@vercel/blob`, `del` parts + old blob. Guards: 3 MB/chunk, 200 chunks max. Node runtime, `maxDuration = 60`. |
| `app/api/admin/upload/chunk/route.ts` | Admin-protected chunk endpoint used by all 5 admin image uploads (settings, partners, pages, modules, learning). |
| `app/api/upload/chunk/route.ts` | Public (rate-limited) chunk endpoint used by the career resume upload. |
| `app/api/admin/upload/route.ts` | Legacy single-shot endpoint. Kept for backward compatibility; admin pages no longer call it. |

**Resume path:** `JobApplicationModal` uploads the PDF via `/api/upload/chunk`, then passes `resumeUrl` + `resumeName` to the `submitApplication` server action, which downloads the assembled blob and forwards the buffer to `uploadToMega()` in `lib/mega.ts` (`(buffer, fileName, folderName)` signature).

**Note:** Vercel Blob's native `uploadPart` multipart was not used — it requires ≥ 5 MB parts, which conflicts with the 4.5 MB request-body limit.

### 6. Email Notification System (Resend — Direct Send + MongoDB Ledger)

**Architecture:** Web forms that send an internal email copy **send the email directly (inline)** in the request. Vercel's Hobby plan allows only 2 cron jobs at a minimum of once/day, so scheduled/queue-drain sending is not viable — delivery therefore never depends on a cron. Every form route sanitizes → validates → saves the submission → resolves recipients → calls Resend synchronously → records the outcome in a MongoDB send ledger. The unique `jobKey` claim gives exactly-once semantics: a retried/duplicate POST can never fire a second email.

**Per-page destinations (single routing model):** every page's form — the `UnifiedContactModal` (client resolves `getDestinationFromPath()` in `lib/form-destinations.ts`, override via the `destination` prop → `POST /api/email/submit`) **and** the inline sidebar forms (→ `POST /api/contact`, destination resolved server-side from the body `destination` or the `Referer` URL) — routes to its page destination. Recipients resolve destination-first from the admin-editable `EMAIL_DESTINATION_RECIPIENTS` map (opt-in — a page with no configured recipient saves the submission but sends **no** email, only `demo` is pre-wired). The legacy per-form-type fallback (`EMAIL_FORM_RECIPIENTS` JSON) then `RESEND_INTERNAL_TO` still applies only to submissions that have no page destination at all. Destinations are grouped into categories (`products` / `services` / `cloud` / `modules` / `addons` / `others`) in the admin UI.

**Why not a cron/queue?** Vercel cron jobs max out at 2/day on Hobby — fine for maintenance, impossible for email scheduling. The old enqueue + `after()`/cron drain design left emails stuck as `pending` if the drain never ran. Direct inline sending removes the scheduler entirely. A failed Resend call is saved in the ledger as `failed` with a `nextRetryAt` and retried on demand (admin panel "Retry Failed Sends") or by an **optional external scheduler**.

| File | Role |
| :--- | :--- |
| `lib/email-queue.ts` | MongoDB `email_queue` collection repurposed as a **send ledger**. `sendEmailDirect()` claims a slot via the unique `jobKey` upsert (first caller owns it), sends through Resend immediately, and writes `sent`/`failed` + `messageId`/`lastError`. `processEmailQueue()` retries `pending`/`failed` jobs atomically (backoff `min(30s·2ⁿ, 4h)`, `maxAttempts = EMAIL_MAX_ATTEMPTS` (5), stale `processing` auto-reset). Terminal jobs get `expireAt` (TTL index purges after 30 days) → bounded memory. |
| `lib/email.ts` | Config + HTML template + `sendInternalFormCopy()`. Recipients are resolved **server-side only** — destination-first (`EMAIL_DESTINATION_RECIPIENTS` per-page map, opt-in), then per-form-type (`EMAIL_FORM_RECIPIENTS` JSON in settings, legacy fallback for submissions with no page destination), then `RESEND_INTERNAL_TO`. Clients can never control recipients. `replyTo` is only set when the submitted email is valid (enquiry forms that collect only a phone number skip it). `getEmailDiagnostic()` returns masked config incl. per-form + per-destination maps. |
| `app/api/email/submit/route.ts` | Public, rate-limited (~30/min/IP). Sanitizes → validates → saves submission → calls `sendEmailDirect()` **inline**. Returns `{ ok, saved, sent, deduped, jobId }`. No `after()`, no cron dependency. |
| `app/api/contact/route.ts` | Legacy endpoint for inline sidebar forms (product/cloud/HRMS/contact/find-solution pages). Now destination-aware: resolves the page destination from the body `destination` or the `Referer` URL, saves the submission, and calls `sendEmailDirect()` inline. Rate-limited, deduped by `requestId`. Pages without a destination keep the old save-only behavior. |
| `app/api/admin/email/process/route.ts` | Admin-only retry drain for failed sends. Accepts the admin session (proxy `x-admin-key`/cookie — panel + tests) **or** an external scheduler call (verifies `Authorization: Bearer <CRON_SECRET>` when set, else the `x-vercel-cron-schedule` + `vercel-cron/*` user-agent signature). |
| `app/api/admin/email/queue/route.ts` | Admin-only ledger stats + recent sends (recipients masked). |
| `app/admin/email-config/page.tsx` | Admin UI (merged, single structure): sender address + "Recipients by Page" grouped by enquiry category (`products` / `services` / `cloud` / `modules` / `others`, sorted per page, page paths shown, one receiver input each → `EMAIL_DESTINATION_RECIPIENTS` JSON, opt-in) + send-ledger panel + "Retry Failed Sends" button. The legacy per-form-type editor was removed from the UI — per-page routing covers every form; the server-side form-type fallback remains for unmapped submissions. |
| `scripts/bootstrap.mjs` / `app/api/admin/bootstrap/route.ts` | Seed `EMAIL_FORM_RECIPIENTS` + `RESEND_SENDER_EMAIL` only if missing (`$setOnInsert` so admin edits persist). |
| `scripts/email-test.mjs` | `npm run test:email`. Default SINGLE mode = exactly 1 email. Verifies direct send, dedupe, admin-only retry, per-form recipients. `EMAIL_FULL_TEST=1` opts into sanitization/concurrency/rate-limit suites. |

**Exactly-once guarantee:** the client generates a `requestId` once per modal open; the server claims the ledger slot by `jobKey = requestId` via a unique-index upsert, and only the claimer sends. Retried/duplicate POSTs (same key) return `deduped: true` and never fire a second email. Sent/failed/dead jobs are TTL-purged.

**Scheduling alternatives when a future time-based email is needed (Vercel cron can't):**
1. **Direct inline send (current)** — the default; no scheduling needed for instant notifications.
2. **GitHub Actions cron** — a free workflow (`schedule: '*/5 * * * *'`) calls `POST /api/admin/email/process?batch=10` with `CRON_SECRET`; Vercel's 2-cron limit doesn't apply.
3. **Upstash QStash** — free-tier scheduled HTTP requests (down to per-second) that hit the same endpoint; purpose-built for serverless cron replacement.
4. **External uptime/heartbeat monitors** (UptimeRobot, Cronitor, Google Cloud Scheduler free tier) pinging the retry endpoint periodically.
5. **Client-visible queue fallback** — keep `processEmailQueue()` behind the admin panel for one-off manual drains if a batch of sends ever fails.

### 7. Brand & Theme (Teal #006569)

- **Primary:** `#006569` — the single brand color across the entire site. Dark variants `#045A57` and `#033B38` for depth and gradients.
- **Light tints:** `#E5F4F4` / `#D4EAEA` / `#B8DEDE` / `#DDEFEF` / `#C5E3E3` / `#D9E8E8` / `#E8F0F0` for section backgrounds, borders and chips.
- **WhatsApp green is preserved:** `#25D366` (buttons) + hover `#1ebe5b` — never change these.
- **Tailwind utilities:** use the `teal-NN` scale (`bg-teal-50`, `text-teal-600`, `border-teal-100`, …). The `green-*`/`emerald-*` families and all hex greens are retired as the brand (bulk-swapped out in commit `dbcb347 teal`) — do not reintroduce them.
- **cPanel landing (`cpanel-landing/app/globals.css`):** local `--color-brand-*` ramp keyed to teal — 50 `#e6f5f5` … 500 `#1b8a8a`, 600 `#006569`, 700 `#005659`, 800 `#044a4b`, 900 `#033d3e`, 950 `#032e2f` — with WhatsApp `#25D366` buttons kept.
- **Palette pickers (`lib/palettes.ts`, `app/(site)/products/product-theme.ts`):** teal-anchored (teal palette "Teal Corporate" `#00897b`/`#005a4e`/`#2dd4bf`, accent `#14b8a6`). Palette ids must stay stable (referenced by stored product data).

### 8. Zoho SalesIQ — Tracking-Only Embed (No Chat UI)

The site loads the client's Zoho SalesIQ widget script **for visitor tracking/analytics only** — the visible chat button is suppressed. Do not re-add a chat widget without explicit instruction.

| File | Role |
| :--- | :--- |
| `app/layout.tsx` | End of `<body>`: raw SSR'd `<script>` tags (NOT `next/script` — order must be guaranteed): inline `window.$zoho` init + `$zoho.salesiq.ready(...)` hook that hides the chat button (`floatbutton.visible("hide")` / `chatbutton.visible("hide")`, try/catch both), then deferred `#zsiqscript` from `salesiq.zohopublic.in`. Root layout → present on every page. |
| `app/globals.css` | CSS suppression layer (bottom of file): `#zs_fl_chat`, `span.siqico-chat.zsiq-chat-icn`, `#zsiqwidget`, `#zsiq_float`, `iframe[src*='salesiq']` → `display:none !important`. The script keeps loading so analytics continue; only the UI is hidden. |
| `next.config.js` | CSP must keep the Zoho domains or tracking silently dies: `script-src`/`connect-src`(incl. `wss:`)/`img-src`/`frame-src` allow `*.zohopublic.in` (+ `*.zohocdn.com` for CDN assets). |

**Permanent alternative:** the chat button can also be disabled server-side in the SalesIQ dashboard (Settings → Widgets → visibility off) — tracking stays on there too.

### 9. Build Discipline (Local Machine)

- **Never run `npm run dev` and `npm run build` at the same time.** Turbopack dev rewrites `.next` while the production build reads it → random `PageNotFoundError: Cannot find module for page: X` failures during "Collecting page data" (the failing page name differs each run).
- This machine has 7.5 GB RAM (~1.3 GB free); `next.config.js` sets `experimental.cpus: 1` to keep build workers from starving. Builds take ~2–4 min.
- If a build fails with that error: stop all node dev processes, delete `.next`, rebuild.
- **Node must be 24.21.0** (`~/.local/node-v24.21.0/bin`, prepended in both `~/.bashrc` and `~/.profile`). `scripts/status-history-test.mjs` imports a `.ts` file directly and therefore needs Node ≥ 22.6's native type stripping. A shell that inherits an older `PATH` will fail it with a version message rather than a syntax error.
- **The agent/tool shell may still resolve an older Node** than a login shell does, because the harness inherits the environment it was started with. Prefix Node commands with `export PATH="$HOME/.local/node-v24.21.0/bin:$PATH"`.

### 10. Status-Change Audit Trail

Every TSS-renewal status transition is recorded on the document itself as an embedded
`statusHistory[]` array, appended by the **same atomic `updateOne`** that sets `status`.

| File | Role |
| :--- | :--- |
| `lib/status-history.ts` | Pure module: the `pending/contacted/renewed/rejected` vocabulary, `statusChangeUpdate()` (SP-3: actor-generalised — accepts `opts.actor`, defaults to `STATUS_ACTOR` `'admin'`), `isValidStatus()`, `buildTimeline()`. No Mongo/React/`next/*` dependency **in types or at runtime**, so it is testable with plain `node` and reusable. |
| `lib/order-status.ts` | **SP-3 (2026-10-03):** order vocabulary wrapper — `ORDER_STATUSES` (`created/verified/refunded/fulfilled`), `isValidOrderStatus()`, `orderStatusChangeUpdate(to, opts?)` (wraps the generalised builder; **no actor option in the wrapper** — the admin panel's orders writes are always `'admin'`, system hops are written by the PUBLIC repo's checkout routes), re-exports `buildTimeline`/`StatusEvent`/`TimelineEntry`/`StatusChangeUpdate`. Imports `./status-history.ts` **with the extension** (loaded by Node type-stripping in tests → `allowImportingTsExtensions` in tsconfig). |
| `scripts/status-history-test.mjs` | `npm run test:status`. 32 zero-dependency assertions (22 TSS + 10 SP-3 order status: accept/refuse all 4 order statuses, `orderStatusChangeUpdate` shape + `note` sanitise + injectable `at`, `buildTimeline` on order histories with derived `from`, actor default `'admin'`); also in `test:all`. |
| `lib/mongodb-utils.ts` | `updateTssRenewalStatus(id, status, note?)` → `findOneAndUpdate(..., { returnDocument: 'after' })`, returning the updated doc (or `null` when nothing matched). **SP-3:** also hosts `updateOrderStatus(id, status, note?)` — same atomic `$set.status` + `$push.statusHistory` pattern via `orderStatusChangeUpdate` against the shared `orders` collection. |
| `app/api/admin/tss-renewals/route.ts` | PATCH validates the status, accepts an optional note, returns post-write `{ status, history }`. |
| `app/admin/tss-renewals/page.tsx` | Newest-first timeline in the detail modal, plus the no-op guard and error feedback described below. |

**Decisions that are load-bearing — do not "simplify" them away:**

- **Embedded array, not a separate collection.** A separate `status_events` collection would need **two** writes, and the Atlas cluster may be M0, which **does not support multi-document transactions**. Status and history could then disagree. One document, one atomic update.
- **Events store `to` only; `from` is derived.** `buildTimeline()` walks the history newest-first and takes each entry's `from` from the next-older entry's `to`. Storing `from` would force a read-before-write to learn the current status, opening a race between two admins acting at once.
- **No backfill.** Existing renewals predate the feature and their true history is unrecoverable. The oldest entry renders `from: null` → "created as", with the footnote "History began 2026-10-02". **Do not fabricate a synthetic prior state.**
- **`actor` defaults to `'admin'`; TSS callers never set it.** `lib/admin-auth.ts` hardcodes a single identity and the session token carries no username, so attribution is structurally impossible today — the trail's value is the **timeline**, not who did it. **SP-3 (2026-10-03):** `statusChangeUpdate` gained an optional `opts.actor` so the PUBLIC repo's checkout flow can record its own hops (`created`/`verified` with actor `system`); this repo's order wrapper **deliberately exposes no actor option** — every write from this panel is `'admin'`. Building a user model is a separate decision.
- **The vocabulary lives in exactly one place.** The admin buttons and the PATCH validation both import `TSS_RENEWAL_STATUSES`, so the UI cannot offer a status the endpoint rejects.

**Three live bugs fixed in the same path** (pre-existing, not introduced here): the PATCH endpoint accepted **any string** as a status; a missing or malformed id returned **200** instead of 404 (and `new ObjectId(id)` threw into the catch-all as a **500**); and `handleStatus` fired a request even when the status was unchanged, which under this feature would append a **duplicate audit event** on every re-click.

**Not yet adopted anywhere.** Job applications, form submissions and problem reports have **no status vocabulary** — they only contain HTTP-status noise. Adopting the helper there requires the owner to define those statuses first. **Do not invent them.**

**SP-1's Orders screen must reuse `statusChangeUpdate`** rather than writing its own status write, so orders get the audit trail from their first commit instead of needing a backfill migration.

### 11. Prices Admin Manager (SP-1 cart build, 2026-10-02)

The **DB-driven price catalog** that powers the public site's cart is edited here. The `prices` collection is shared (both repos point at the same Atlas URI); the admin writes, the public site reads.

| File | Role |
| :--- | :--- |
| `lib/prices-catalog.mjs` (+`.d.mts`) / `lib/prices.ts` / `lib/prices-server.ts` | Hand-ported copies of the public repo's single source of truth (pure-ESM catalog + typed facade + Mongo read with identical-number fallback). **Port changes from the public repo by hand** — the forks have drifted (§0). |
| `app/api/admin/prices/route.ts` | GET list / POST create / POST `action:'bootstrap'` (idempotent seed, `$setOnInsert`) / PUT update / DELETE. **Slug rename cascades**: `$pullAll`+`$push` retargets every `pairsWith`/`addonSlugs`/`moduleSlugs` referrer on other docs, so renaming `tallyprime-silver` never leaves a dangling pointer; DELETE removes the renamed slug from every other doc's arrays. `validatePriceItem` emits ISO date strings vs the seed's Mongo Dates — `toPriceItem` normalises both. |
| `app/admin/prices/page.tsx` | Rupee input ↔ paise wire, validation feedback, save/edit/delete. New row scaffolded from a 17-item fallback so a fresh DB is still fully manageable. |
| `app/admin/AdminSidebar.tsx` | "Prices" entry added under the catalog group. |

**Load-bearing rules:** prices are **paise on the wire** (`pricePaise`, `basePaise`, `payablePaise`) and rupees in the input; the public `/api/prices` serves what the site renders, and the site **never** trusts a client amount — the cart order recomputes totals server-side from this collection. If the DB returns no rows the site serves catalog numbers identical to the fallback, so admin edits can never blank a page. `npm run typecheck` stays 0 (the boundary casting for `$pullAll`/`$push` lives in `mongodb-utils.ts`).

### 12. Payments Admin — Order Ledger + Summary (SP-3, 2026-10-03)

The read-only **orders ledger** + **summary/export** for the public site's checkout. The `orders` collection is written by the PUBLIC repo (`/api/cart/order` persists `customer`/`tssSerials`/`statusHistory`; `/api/cart/verify` appends the `verified` hop). This repo's write surface is **exactly status + note** — **no delete, no buyer-field editing** (owner's reframing).

| File | Role |
| :--- | :--- |
| `lib/order-status.ts` | Vocabulary + atomic-update builder (see §10 table). Single source of truth — the pages and the API both import it, so the panel cannot offer a status the route rejects (the §10 rule). |
| `lib/mongodb-utils.ts` → `updateOrderStatus(id, status, note?)` | `findOneAndUpdate(..., { returnDocument: 'after' })` on `orders` with `orderStatusChangeUpdate` (cast at the boundary, like `updateTssRenewalStatus`). 404-equivalent: returns `null` when nothing matched. |
| `app/api/admin/payments/route.ts` | **GET** — filters `status` (invalid → 400), `from`/`to` ISO dates (unparsable → 400, `createdAt` range), `q` (escaped regex over `orderId`/`customer.name`/`customer.email`/`customer.phone`); pagination `page` (≥1, default 1) / `limit` (default 25, max 100); `export=1` ignores pagination and caps at 5000; sort `createdAt` desc; **projection `{ ip: 0 }` — the `_id` is KEPT** (serialised by `serializeData`) because the POST addresses orders by ObjectId (the plan doc's `{ _id: 0, ip: 0 }` shorthand was an error). Response `{ items, total, page, totalPages, export }`. **POST** — `{ id, status, note? }`: invalid ObjectId → 400, invalid status → 400, `updateOrderStatus` returning `null` → 404; returns `{ ok, message, order, timeline: buildTimeline(order.statusHistory) }`. Only `refunded`/`fulfilled` are offered by the UI (the flow-side hops are the public repo's). `export const dynamic = 'force-dynamic'`; auth handled by the deployment's `proxy.ts` guard (sibling-route convention). |
| `app/admin/payments/page.tsx` | Ledger: filter bar (status select from `ORDER_STATUSES` + All, from/to dates, `q`, Apply/Reset), read-only table (created, orderId, customer name/email/phone/company, first item + count, **TSS serial(s) joined from `tssSerials`**, amount via local `formatAmount` (₹ `Intl` en-IN — the nested repo has no public `formatINR`), status badge), pagination (`PAGE_SIZES` + `getPageNumbers` copied from `submissions/page.tsx`), detail modal: items + totals + razorpay ids + **timeline** (same newest-first UI as tss-renewals, `from: null` → "created as") + status-change form (select `refunded`/`fulfilled` + note ≤300 + Save; **no-op guard** — re-click of the current status never fires, SP-2's duplicate-event bug; buttons disabled in flight), **XLSX export** (client-side `?export=1` → SheetJS, paise → ₹ numbers). |
| `app/admin/payments/summary/page.tsx` | Summary: same filter bar; totals over **all filtered rows** (`?export=1`): orders count, Total Collected, GST Collected, Average Order (+ total discounts line when > 0); filtered-rows table; **Print / Save PDF** via `window.print()` with a scoped-print `<style>` (`body *:not(.payments-summary-print):not(.payments-summary-print *):not(:has(.payments-summary-print)) { display: none !important }` — the public receipt's trick; the `:has()` rule requires a modern engine, fine for a desktop admin panel); **XLSX export** of the same rows. |
| `app/admin/payments/tabs.tsx` | Tiny `Ledger | Summary` tab switcher shared by both pages (the sidebar has **one** entry — "Payments"; the tabs switch views). |
| `app/admin/AdminSidebar.tsx` | "Payments" entry added after "Prices" (same `data`-array style; credit-card icon path). |

**Load-bearing rules:** amounts are **paise on the wire** and ₹ in the UI (same convention as §11). The GET **never** returns `ip` (payments-record privacy, spec §4.4) but **always** returns `_id`. The only write is status+note ingestion; do not add DELETE or buyer-field PATCHing without the owner asking.

## Developer Guidelines
- **Surgical Updates:** Always prefer targeted `replace` over complete file rewrites for existing files.
- **Accessibility:** Maintain high contrast ratios and ensure interactive elements have clear focus states.
- **Mobile First:** All new components must be verified for performance and layout on small screens (minimum 360px).
- **GPU Hints:** Use `will-change` and `translateZ(0)` sparingly for elements with complex animations.
- **Never Assume:** If in doubt about any requirement, requirement scope, or implementation detail, ALWAYS ask the user for clarification before proceeding. Never guess or fill gaps with assumptions.
- **Minimal Code / Use Libraries:** Do not over-engineer. If a library or npm package solves the problem in fewer lines, use it. Avoid writing 200 lines when 30 lines + a dependency does the same job. Prefer `xlsx` over custom CSV builders, `date-fns` over hand-rolled date logic, etc.
- **Document All Changes:** Every file edit must include a comment or commit message explaining WHAT changed and WHY. We maintain daily changelogs and an Excel tracker — AI-generated changes must be traceable. Use `// CHANGE: <date> — <reason>` inline comments for non-obvious edits.
- **Validate Before Completing:** Before marking any task as done, re-read the original user request, re-check every todo item, and verify each requirement is actually satisfied. Requirements get silently dropped during scope — always do a second pass against the original prompt to ensure nothing was missed.

---
*Last Updated: 2026-10-03 (SP-3 payments admin — §10 actor-generalised audit builder + `lib/order-status.ts`, new §12 order ledger + summary)*
