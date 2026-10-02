import { NextResponse } from 'next/server';
import { ObjectId, type UpdateFilter } from 'mongodb';
import type { Document } from 'mongodb';
import { getDb, isValidObjectId } from '@/lib/mongodb-utils';
import { PRICES_FALLBACK } from '@/lib/prices-catalog.mjs';
import { validatePriceItem } from '@/lib/prices';
import type { PriceItem } from '@/lib/prices-catalog.mjs';

// CHANGE: 2026-10-02 — admin price manager (SP-1 cart build).
// WHY: the frontend cart prices come from the shared MongoDB `prices` collection. This is
// the admin side of that: list, create, update (with slug-rename cascade) and delete.
// Validation lives in lib/prices.ts `validatePriceItem` — the SAME validator the test
// suite pins — so an admin cannot write a document the frontend will mis-total.
//
// Auth is NOT handled here: the deployment's admin guard (proxy.ts) already restricts
// /api/admin/*. Follow the sibling admin routes' convention (partners/news) — no per-route
// auth calls.

export const dynamic = 'force-dynamic';

interface PriceDoc extends PriceItem {
  _id?: unknown;
  createdAt?: Date | string;
}

async function listDocs(): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const docs = await db
    .collection('prices')
    .find({})
    .sort({ category: 1, sortOrder: 1, slug: 1 })
    .limit(500)
    .toArray();
  return docs.map((d) => ({ ...d, _id: String(d._id) }));
}

/** The universe of valid slugs for pairsWith validation: catalogue ∪ live DB, minus the
 *  slug being edited (a rename removes it), plus the renamed slug itself. */
async function knownSlugsFor(excludeSlug?: string, extraSlug?: string): Promise<Set<string>> {
  const db = await getDb();
  const slugs = new Set<string>(PRICES_FALLBACK.map((p) => (p as PriceItem).slug));
  const docs = await db.collection('prices').find({}, { projection: { slug: 1 } }).limit(500).toArray();
  for (const d of docs) {
    if (typeof d.slug === 'string' && d.slug !== excludeSlug) slugs.add(d.slug);
  }
  if (extraSlug) slugs.add(extraSlug);
  return slugs;
}

export async function GET() {
  try {
    return NextResponse.json(await listDocs());
  } catch (error) {
    console.error('Error fetching prices:', error);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Bootstrap: re-add every catalogue item that is MISSING, without touching anything
    // an admin has edited ($setOnInsert only). Mirrors scripts/seed_prices.mjs.
    if (body.action === 'bootstrap') {
      const db = await getDb();
      const collection = db.collection('prices');
      let added = 0;
      for (const item of PRICES_FALLBACK) {
        const p = item as PriceItem;
        const { updatedAt: _ignore, ...stored } = p;
        const res = await collection.updateOne(
          { slug: p.slug },
          { $setOnInsert: { ...stored, createdAt: new Date() } },
          { upsert: true },
        );
        if (res.upsertedCount > 0) added += 1;
      }
      return NextResponse.json({ ok: true, added, message: `Added ${added} missing item(s) from the catalogue.` });
    }

    const known = await knownSlugsFor(undefined, typeof body.slug === 'string' ? body.slug : undefined);
    const result = validatePriceItem(body, known);
    if (!result.ok || !result.value) {
      return NextResponse.json({ error: 'Validation failed', errors: result.errors }, { status: 400 });
    }
    const db = await getDb();
    const exists = await db.collection('prices').findOne({ slug: result.value.slug });
    if (exists) {
      return NextResponse.json({ error: 'Validation failed', errors: { slug: 'A price with this slug already exists.' } }, { status: 400 });
    }
    const { updatedAt, ...stored } = result.value;
    const inserted = await db.collection('prices').insertOne({ ...stored, createdAt: new Date(), updatedAt: new Date() });
    return NextResponse.json({ ok: true, message: 'Price created', id: String(inserted.insertedId) });
  } catch (error) {
    console.error('Error creating price:', error);
    return NextResponse.json({ error: 'Failed to create price' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Validation failed', errors: { id: 'A valid price id is required.' } }, { status: 400 });
    }
    const db = await getDb();
    const collection = db.collection('prices');
    const existing = (await collection.findOne({ _id: new ObjectId(id) })) as Record<string, unknown> | null;
    if (!existing) {
      return NextResponse.json({ error: 'Price not found' }, { status: 404 });
    }

    const oldSlug = typeof existing.slug === 'string' ? existing.slug : '';
    const newSlug = typeof body.slug === 'string' ? body.slug.trim() : oldSlug;
    const renamed = newSlug !== oldSlug;

    // Validate the MERGED document (body fields win, existing fields fill the rest).
    const merged: Record<string, unknown> = {
      ...(existing as Record<string, unknown>),
      ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'id' && k !== '_id')),
      slug: newSlug,
    };
    delete merged._id;
    delete merged.createdAt;
    const known = await knownSlugsFor(renamed ? oldSlug : undefined, newSlug);
    const result = validatePriceItem(merged, known);
    if (!result.ok || !result.value) {
      return NextResponse.json({ error: 'Validation failed', errors: result.errors }, { status: 400 });
    }

    // Slug uniqueness (excluding this doc).
    if (newSlug !== oldSlug) {
      const clash = await collection.findOne({ slug: newSlug, _id: { $ne: new ObjectId(id) } });
      if (clash) {
        return NextResponse.json({ error: 'Validation failed', errors: { slug: 'A price with this slug already exists.' } }, { status: 400 });
      }
    }

    const { updatedAt: _ignore, ...stored } = result.value;
    await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...stored, updatedAt: new Date() } },
    );

    // Slug-rename cascade: every OTHER document that referenced the old slug in
    // pairsWith / addonSlugs / moduleSlugs is retargeted to the new slug, so a bundle
    // never silently loses a companion after an admin renames its anchor.
    if (renamed) {
      const referrers = await collection
        .find({ $or: [{ pairsWith: oldSlug }, { addonSlugs: oldSlug }, { moduleSlugs: oldSlug }] })
        .project({ _id: 1 })
        .toArray();
      for (const ref of referrers) {
        // Cast at the driver boundary (same pattern as lib/mongodb-utils.ts): Mongo's
        // UpdateFilter constrains $pullAll/$push via NotAcceptedFields against a bare
        // `Document`, reducing the value type to `never`. The shape is valid.
        await collection.updateOne(
          { _id: ref._id },
          {
            $pullAll: { pairsWith: [oldSlug], addonSlugs: [oldSlug], moduleSlugs: [oldSlug] },
            $push: { pairsWith: newSlug },
          } as unknown as UpdateFilter<Document>,
        );
      }
    }

    return NextResponse.json({ ok: true, message: renamed ? 'Price updated (slug renamed + references updated)' : 'Price updated', renamed });
  } catch (error) {
    console.error('Error updating price:', error);
    return NextResponse.json({ error: 'Failed to update price' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || '';
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Validation failed', errors: { id: 'A valid price id is required.' } }, { status: 400 });
    }
    const db = await getDb();
    const collection = db.collection('prices');
    const existing = (await collection.findOne({ _id: new ObjectId(id) })) as Record<string, unknown> | null;
    if (!existing) {
      return NextResponse.json({ error: 'Price not found' }, { status: 404 });
    }
    const slug = typeof existing.slug === 'string' ? existing.slug : '';
    await collection.deleteOne({ _id: new ObjectId(id) });
    // Hygiene: drop dangling references to the deleted slug everywhere.
    if (slug) {
      const cleanup = {
        $pullAll: { pairsWith: [slug], addonSlugs: [slug], moduleSlugs: [slug] },
      } as unknown as UpdateFilter<Document>;
      await collection.updateMany(
        { $or: [{ pairsWith: slug }, { addonSlugs: slug }, { moduleSlugs: slug }] },
        cleanup,
      );
    }
    return NextResponse.json({ ok: true, message: 'Price deleted' });
  } catch (error) {
    console.error('Error deleting price:', error);
    return NextResponse.json({ error: 'Failed to delete price' }, { status: 500 });
  }
}