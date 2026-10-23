// CHANGE: 2026-10-22 — deterministic regression suite for THIS fork's topic
// matcher (lib/sara-topics.ts).
//
// WHY: on 22/10/2026 in production Sara pasted a raw TDL snippet to a visitor
// who asked "CAN YOU DRAFT TDL". The topic matcher is the offline half of the
// fix (the live half is lib/sara-guard.mjs, pinned by scripts/sara-guard-test.mjs):
// a custom-build request must land on the "TDL & Customisation" topic, and the
// OFFLINE fallbacks must never emit code either.
//
// Runs standalone with Node 24 native TS type-stripping — no server, no AI,
// no tokens spent:
//   node scripts/sara-topics-test.mjs
import { getFallbackResponse, getTeachingFallbackResponse, matchTopic, saraTopics } from '../lib/sara-topics.ts';
import { containsProgrammingCode } from '../lib/sara-guard.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ${name} ... PASS`);
    passed++;
  } catch (err) {
    console.log(`  ${name} ... FAIL — ${err.message}`);
    failed++;
  }
}

function expectMatch(query, expectedLabel) {
  const r = matchTopic(query);
  if (!r) throw new Error(`"${query}" -> null, expected "${expectedLabel}"`);
  if (r.topic.label !== expectedLabel) {
    throw new Error(`"${query}" -> "${r.topic.label}" (score ${r.score}), expected "${expectedLabel}"`);
  }
}

console.log('\n🧠 Sara Topic Matcher (this fork) — Local Regression (no server/AI)\n');

// ─── TDL / custom build must land on the consultant topic, never on code ────
// CHANGE: 2026-10-22 — Sara is a business consultant, NOT a programmer. A TDL
// request must resolve to the "TDL & Customisation" topic (which asks the
// requirement questions and routes to the technical team) instead of being
// answered with a generic reports list or, worse, with code.
console.log('🧱 TDL / custom build isolation');
test('"tdl" maps to TDL & Customisation', () => expectMatch('tdl', 'TDL & Customisation'));
test('"can you draft tdl" maps to TDL & Customisation', () => expectMatch('can you draft tdl', 'TDL & Customisation'));
test('"tdl customization" maps to TDL & Customisation', () => expectMatch('tdl customization', 'TDL & Customisation'));
test('"custom report for gst" maps to TDL & Customisation', () => expectMatch('custom report for gst', 'TDL & Customisation'));
test('"custom invoice format" maps to TDL & Customisation', () => expectMatch('custom invoice format', 'TDL & Customisation'));
test('the production phrase maps to TDL & Customisation', () =>
  expectMatch('draft tdl for add pending invoices in sales invoice', 'TDL & Customisation'));

test('the TDL topic answer contains no code', () => {
  const t = saraTopics.find(x => x.label === 'TDL & Customisation');
  if (!t) throw new Error('TDL topic missing');
  if (containsProgrammingCode(t.answer)) throw new Error('TDL topic answer contains code');
});
test('the TDL topic answer asks the requirement questions', () => {
  const t = saraTopics.find(x => x.label === 'TDL & Customisation');
  if (!t) throw new Error('TDL topic missing');
  if (!t.answer.includes('?')) throw new Error('TDL topic answer asks no question');
  if (!t.answer.includes('[[TDL Customization|/services/tdl]]')) throw new Error('TDL topic answer has no button');
});

// ─── The OFFLINE fallbacks must behave like the live reply ─────────────────
console.log('🛟 Offline fallbacks');
test('the sales fallback refuses code for a TDL request', () => {
  const r = getFallbackResponse('CAN YOU DRAFT TDL');
  if (containsProgrammingCode(r)) throw new Error('fallback emitted code');
  if (!r.includes('?')) throw new Error('fallback asked no question');
});
test('the sales fallback routes a TDL request to the TDL page', () => {
  const r = getFallbackResponse('I want a custom invoice format in TDL');
  if (!r.includes('[[TDL Customization|/services/tdl]]')) throw new Error('fallback has no TDL button');
});
test('a NON-TDL build request routes to the specialist page', () => {
  const r = getFallbackResponse('I want a custom invoice format');
  if (!r.includes('[[Talk to a Specialist|/contact]]')) throw new Error('fallback has no specialist button');
  if (r.includes('[[TDL Customization|/services/tdl]]')) throw new Error('non-TDL build wrongly points at the TDL page');
});
test('the teaching fallback refuses code for a TDL request', () => {
  const r = getTeachingFallbackResponse('write a tdl for pending invoices');
  if (containsProgrammingCode(r)) throw new Error('teaching fallback emitted code');
});

// ─── Catalogue suggestions (OFFLINE Sara must suggest what we sell) ──────────
// CHANGE: 2026-10-22 (ADMIN FORK) — the owner asked Sara to know our add-ons,
// products and modules "with details" and to suggest them. The live path uses
// the generated catalogue prompt; this covers the OFFLINE path (API down). The
// Tally Insights hub is not deployed in this fork, so there is no guide assertion
// and guideSuggestionReply() is always a no-op here.
console.log('\n🛍 Catalogue suggestions');
test('offline fallback suggests the right add-on for a business problem', () => {
  const r = getFallbackResponse('stop billing customers who have not paid');
  if (!r.includes('Block Billing beyond Due Date')) throw new Error('got: ' + r.slice(0, 120));
  if (!r.includes('[[Block Billing beyond Due Date|/addons#block-billing-beyond-due-date]]')) {
    throw new Error('the add-on reply has no button');
  }
});
test('offline fallback suggests an industry module when one matches', () => {
  const r = getFallbackResponse('we are a transport business and need lorry receipt billing');
  if (!r.includes('Transport Module')) throw new Error('got: ' + r.slice(0, 120));
});
test('offline fallback does not hijack a remote-access question into code', () => {
  const r = getFallbackResponse('can I access Tally from home');
  if (r.includes('/services/tdl')) throw new Error('remote-access wrongly pointed at TDL');
  if (!r.includes('?') && !r.includes('/addons') && !r.includes('/cloud') && !r.includes('Tally')) throw new Error('got: ' + r.slice(0, 140));
});
test('offline fallback still answers a price question with the sales route', () => {
  const r = getFallbackResponse('what is the price of tallyprime gold');
  if (!/price|pricing|quote/i.test(r)) throw new Error('price question was hijacked: ' + r.slice(0, 120));
  if (r.includes('Block Billing')) throw new Error('catalogue hijacked a price question');
});
test('offline fallback still refuses a custom build with the requirement questions', () => {
  const r = getFallbackResponse('can you draft a TDL for pending invoices');
  if (!r.includes('/services/tdl')) throw new Error('got: ' + r.slice(0, 120));
});

// ─── The existing topics must still resolve ────────────────────────────────
// CHANGE: 2026-10-22 — NOTE the known fork drift: this fork never received the
// public repo's 2026-09-05 `keywords` synonyms for the CORE topics, so a bare
// "stock" still resolves to null here (verified against the pre-change file:
// "stock" -> null). That is pre-existing behaviour, NOT a regression from this
// change — the assertion below pins it so a future port is deliberate.
console.log('🗂 Existing topics still resolve');
test('"stock" is still null in this fork (known drift, unchanged)', () => {
  const r = matchTopic('stock');
  if (r) throw new Error(`"stock" -> "${r.topic.label}" (score ${r.score}), expected null (known drift)`);
});
test('"gst" maps to GST & Tax Filing', () => expectMatch('gst', 'GST & Tax Filing'));
test('"tss renewal" maps to TSS Renewal', () => expectMatch('tss renewal', 'TSS Renewal & Subscription'));
test('"payroll" maps to Payroll & Employees', () => expectMatch('payroll', 'Payroll & Employees'));
test('"reports" maps to Reports & Analysis', () => expectMatch('reports', 'Reports & Analysis'));

console.log(`\n${failed === 0 ? '✅' : '❌'} Sara topics (this fork): ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
