// CHANGE: 2026-10-22 — NEW (ADMIN FORK): deterministic regression suite for the catalogue
// Sara sells from.
//
// WHY: the owner asked Sara to know our add-ons, products and modules "with details" so she
// can SUGGEST them. This suite locks that down WITHOUT an LLM: the catalogue is pure data,
// so every claim below is deterministic.
//
// Porting note (root AGENTS.md 10, rule 4): hand-ported from the public repo's
// scripts/sara-catalog-test.mjs. The Tally Insights KNOWLEDGE HUB is not deployed in this
// fork yet (it is newer than the fork), so the lesson assertions are replaced by an
// assertion that NO /tally-insights link is emitted here - a button that 404s in this
// deployment is worse than no button.
//
// Runs standalone with plain Node (the .mjs modules need no build step) - no server, no AI,
// no tokens spent.
import {
  PRODUCTS,
  ADDONS_CATALOGUE,
  buildCatalogPromptBlock,
  buildGuidesPromptBlock,
  suggestCatalog,
  catalogSuggestionReply,
  guideSuggestionReply,
} from '../lib/sara-catalog.mjs';
import { addons } from '../lib/addons.mjs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = fileURLToPath(new URL('../app/(site)', import.meta.url));

/** Every route this deployment actually serves under app/(site). */
function siteRoutes(dir = SITE_DIR, base = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups ((site), (marketing) ...) are not part of the URL.
      const next = entry.startsWith('(') ? base : `${base}/${entry}`;
      out.push(...siteRoutes(full, next));
    } else if (entry === 'page.tsx') {
      out.push(base || '/');
    }
  }
  return out;
}

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\n📦 Sara Catalogue — Products & Add-ons (no server/AI)\n');

// ─── Add-ons: one source of truth, fully described ──────────────────────────
console.log('🔌 Add-ons catalogue');
test('the add-ons catalogue still holds the 20 published add-ons', () => {
  assert(addons.length === 20, `expected 20 add-ons, got ${addons.length}`);
});
test('every add-on has an id, title, description, useCase and keywords', () => {
  for (const a of addons) {
    assert(a.id && /^[a-z0-9-]+$/.test(a.id), `bad id: ${a.id}`);
    assert(a.title && a.title.length > 3, `bad title: ${a.id}`);
    assert(a.description && a.description.length > 10, `bad description: ${a.id}`);
    assert(a.useCase && a.useCase.length > 10, `no useCase (the "detail"): ${a.id}`);
    assert(Array.isArray(a.keywords) && a.keywords.length >= 3, `no keywords: ${a.id}`);
  }
});
test('add-on ids are unique', () => {
  const seen = new Set();
  for (const a of addons) {
    assert(!seen.has(a.id), `duplicate add-on id: ${a.id}`);
    seen.add(a.id);
  }
});
test('no add-on description contains code markers', () => {
  for (const a of addons) {
    assert(!/\[#Menu:|\[System:|\[Function:|OnAction\s*:|\$\$/.test(a.description), `code in: ${a.id}`);
  }
});

// ─── Products, services and modules ─────────────────────────────────────────
console.log('🏢 Products, services & modules');
test('every product has an id, label, detail, url and keywords', () => {
  for (const p of PRODUCTS) {
    assert(p.id, 'missing id');
    assert(p.label && p.label.length > 2, `bad label: ${p.id}`);
    assert(p.detail && p.detail.length > 10, `no detail: ${p.id}`);
    assert(p.url.startsWith('/'), `bad url: ${p.id}`);
    assert(Array.isArray(p.keywords) && p.keywords.length >= 3, `no keywords: ${p.id}`);
  }
});
test('product ids are unique', () => {
  const seen = new Set();
  for (const p of PRODUCTS) {
    assert(!seen.has(p.id), `duplicate product id: ${p.id}`);
    seen.add(p.id);
  }
});
test('the six industry modules are present', () => {
  const need = ['module-cfa', 'module-housing-society', 'module-salesman', 'module-transport', 'module-container', 'module-garment'];
  for (const id of need) assert(PRODUCTS.some(p => p.id === id), `missing module: ${id}`);
});
test('TSS is in the catalogue and names both renewal paths', () => {
  const tss = PRODUCTS.find(p => p.id === 'tss-renewal');
  assert(tss, 'TSS missing from the catalogue');
  assert(tss.detail.includes('Alt+R'), 'TSS detail is missing the Alt+R path');
  assert(tss.detail.includes('F9'), 'TSS detail is missing the F1 > Settings > License > Manage License > F9 path');
  assert(tss.detail.includes('Silver, Gold and Server'), 'TSS detail must say it works on every edition');
});
test('every product url points at a page that exists in THIS deployment', () => {
  // The forks drifted: a page can exist in the public repo and be missing here. A catalogue
  // link that 404s in this deployment is a dead end for the visitor. The route list is read
  // from the real app/(site) tree, so this assertion cannot go stale.
  const routes = new Set(siteRoutes());
  for (const p of PRODUCTS) {
    const path = p.url.split('#')[0];
    assert(routes.has(path), `unknown page for ${p.id}: ${path}`);
  }
});

// ─── The generated prompt blocks ────────────────────────────────────────────
console.log('📝 Generated prompt blocks');
test('the sales block contains every product and every add-on', () => {
  const block = buildCatalogPromptBlock();
  for (const p of PRODUCTS) assert(block.includes(p.label), `block is missing product: ${p.label}`);
  for (const a of addons) assert(block.includes(a.title), `block is missing add-on: ${a.title}`);
  assert(block.includes(ADDONS_CATALOGUE.label), 'block is missing the add-ons catalogue entry');
});
test('the sales block links every add-on to its /addons anchor', () => {
  const block = buildCatalogPromptBlock();
  for (const a of addons) assert(block.includes(`/addons#${a.id}`), `block is missing anchor for: ${a.id}`);
});
test('the guides block points at the tutorials page that exists here', () => {
  const block = buildGuidesPromptBlock();
  assert(block.includes('/tutorials'), 'guides block does not point at /tutorials');
});
test('no block links the knowledge hub - it is not deployed in this fork', () => {
  for (const block of [buildCatalogPromptBlock(), buildGuidesPromptBlock()]) {
    assert(!block.includes('/tally-insights'), 'a /tally-insights link would 404 in this deployment');
  }
});
test('every button in both blocks is well formed', () => {
  for (const block of [buildCatalogPromptBlock(), buildGuidesPromptBlock()]) {
    const opens = (block.match(/\[\[/g) || []).length;
    const closes = (block.match(/\]\]/g) || []).length;
    assert(opens === closes, `unbalanced buttons: ${opens} open vs ${closes} close`);
    assert(!/\[\[\s|\s\]\]/.test(block), 'a button has spaces around the pipe');
  }
});
test('neither block contains code markers', () => {
  for (const block of [buildCatalogPromptBlock(), buildGuidesPromptBlock()]) {
    assert(!/\[#Menu:|\[System:|\[Function:|OnAction\s*:|\$\$/.test(block), 'code marker in a prompt block');
  }
});

// ─── The suggestion engine (the "advising" part) ────────────────────────────
console.log('🎯 Suggestion engine');
function expectAddon(query, expectedTitle) {
  const { addons: hits } = suggestCatalog(query);
  assert(hits.length > 0, `"${query}" -> no add-on suggested`);
  assert(hits[0].title === expectedTitle, `"${query}" -> "${hits[0].title}", expected "${expectedTitle}"`);
}
test('"stop billing customers who have not paid" -> Block Billing beyond Due Date', () =>
  expectAddon('stop billing customers who have not paid', 'Block Billing beyond Due Date'));
test('"email the invoice to the customer automatically" -> Auto Email Sales Invoices', () =>
  expectAddon('email the invoice to the customer automatically', 'Auto Email Sales Invoices after Save'));
test('"maker checker approval before posting" -> Single Level Maker & Checker', () =>
  expectAddon('maker checker approval before posting', 'Single Level Maker & Checker'));
test('"discount on discount for wholesalers" -> Double Discount', () =>
  expectAddon('discount on discount for wholesalers', 'Double Discount'));
test('"stop my staff changing the rate in sales" -> Skip Rate Field for Users', () =>
  expectAddon('stop my staff changing the rate in sales', 'Skip Rate Field for Users in Sales Voucher Entry Screen'));
test('"do not sell below the last purchase rate" -> Lock Sales Below Last Purchase Rate', () =>
  expectAddon('do not sell below the last purchase rate', 'Lock Sales Below Last Purchase Rate'));
test('"duplicate supplier invoice invoice entry" -> Duplicate Purchase Block', () =>
  expectAddon('duplicate supplier invoice entry', 'Duplicate Purchase Block based on Supplier Invoice Number & Supplier GSTIN'));
test('"show the last purchase cost while billing" -> Show Last Purchase Cost in Sales', () =>
  expectAddon('show the last purchase cost while billing', 'Show Last Purchase Cost in Sales'));

test('"transport module lorry receipt" -> the Transport Module', () => {
  const { modules } = suggestCatalog('transport module lorry receipt');
  assert(modules.length > 0, 'no module suggested');
  assert(modules[0].id === 'module-transport', `got ${modules[0].id}`);
});
test('"tallydrive scheduled backup" -> TallyDrive', () => {
  const { products } = suggestCatalog('tallydrive scheduled backup');
  assert(products.length > 0, 'no product suggested');
  assert(products[0].id === 'tallydrive', `got ${products[0].id}`);
});
test('"encrypted cloud backup of my data" -> Backup for TallyPrime', () => {
  const { products } = suggestCatalog('encrypted cloud backup of my data');
  assert(products.length > 0, 'no product suggested');
  assert(products[0].id === 'backup-for-tally', `got ${products[0].id}`);
});
test('gibberish suggests nothing', () => {
  const r = suggestCatalog('zzzz qqqq wwwww');
  const total = r.products.length + r.addons.length + r.guides.length + r.modules.length + r.learning.length;
  assert(total === 0, `gibberish matched ${total} items`);
});

// ─── The offline reply shape ────────────────────────────────────────────────
console.log('💬 Offline replies');
test('catalogSuggestionReply gives the item, the detail, a button and a question', () => {
  const reply = catalogSuggestionReply('stop billing customers who have not paid');
  assert(reply, 'no reply produced');
  assert(reply.includes('Block Billing beyond Due Date'), 'reply does not name the add-on');
  assert(reply.includes('[[Block Billing beyond Due Date|/addons#block-billing-beyond-due-date]]'), 'reply has no button');
  assert(reply.includes('?'), 'reply asks no question');
});
test('catalogSuggestionReply returns null for gibberish', () => {
  assert(catalogSuggestionReply('zzzz qqqq wwwww') === null, 'gibberish produced a reply');
});
test('guideSuggestionReply returns null - there is no knowledge hub in this deployment', () => {
  assert(guideSuggestionReply('cost centre department wise') === null, 'a guide reply was produced');
});

const total = passed + failed;
console.log(`\n${'━'.repeat(50)}`);
console.log(`  Total: ${total}  |  PASSED: ${passed}  |  FAILED: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
