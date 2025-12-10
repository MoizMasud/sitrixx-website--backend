// api/reviews.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { clientId, name, rating, comments } = (req.body as any) || {};

    if (!clientId || typeof rating !== 'number') {
      return res
        .status(400)
        .json({ error: 'clientId and numeric rating are required' });
    }

    // Look up client config (we need Google review link + owner email)
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ error: 'Invalid clientId' });
    }

    // Save review internally
    const { data, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        client_id: clientId,
        name,
        rating,
        comments,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting review:', error);
      return res.status(500).json({ error: 'Failed to save review' });
    }

    // For now: just return the Google link if rating is 5.
    // Later we’ll also send an email to owner on bad reviews.
    const googleReviewLink = rating >= 5 ? client.google_review_link : null;

    return res.status(201).json({
      ok: true,
      review: data,
      googleReviewLink,
    });
  } catch (err) {
    console.error('Invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
}
