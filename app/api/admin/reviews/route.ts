import { NextResponse } from 'next/server';
import { getReviews, addReview, deleteReview, updateReview } from '@/lib/mongodb-utils';
import { staticReviews } from '@/lib/reviews';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// CHANGE: 2026-10-23 — one sanitizer for POST + PUT. Adds `role` (e.g. CA) and makes
// `rating` OPTIONAL: curated Google reviews do not always carry a star count, and the
// homepage card now renders stars only when a rating exists (no invented ratings).
function normalizeReview(data: any): Record<string, unknown> | null {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!name || !text) return null;
  const out: Record<string, unknown> = { name, text };
  const rating = Number(data?.rating);
  if (Number.isFinite(rating) && rating >= 1 && rating <= 5) out.rating = Math.round(rating);
  if (typeof data?.date === 'string' && data.date.trim()) out.date = data.date.trim().slice(0, 40);
  if (typeof data?.role === 'string' && data.role.trim()) out.role = data.role.trim().slice(0, 24);
  if (typeof data?.source === 'string' && data.source.trim()) out.source = data.source.trim().slice(0, 40);
  return out;
}

export async function GET() {
  try {
    let reviews = await getReviews();
    
    // Seed if empty
    if (reviews.length === 0) {
      const client = await clientPromise;
      const db = client.db();
      const collection = db.collection('reviews');
      await collection.insertMany(staticReviews.map(({ id, _id, ...r }) => ({ ...r, createdAt: new Date() })));
      reviews = await getReviews();
    }
    
    return NextResponse.json(reviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const clean = normalizeReview(data);
    if (!clean) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const result = await addReview(clean);
    return NextResponse.json({ message: 'Review added successfully', id: result.insertedId });
  } catch (error) {
    console.error('Error adding review:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to add review' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    await deleteReview(id);
    return NextResponse.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    return NextResponse.json({ error: 'Failed to delete review' }, { status: 500 });
  }
}

async function handleUpdate(request: Request) {
  try {
    const data = await request.json();
    const id = data.id;
    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const { id: _id, ...rest } = data;
    const clean = normalizeReview(rest);
    if (!clean) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const result = await updateReview(id, clean);
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Review updated successfully' });
  } catch (error) {
    console.error('Error updating review:', error);
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return handleUpdate(request);
}

export async function PATCH(request: Request) {
  return handleUpdate(request);
}
