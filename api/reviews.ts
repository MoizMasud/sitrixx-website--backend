// api/reviews.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { resendClient } from '../resendClient';
import { applyCors } from './_cors';
import { requireAuth } from './_auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS + OPTIONS
  if (applyCors(req, res)) return;

  // ----------------------------------
  // GET /api/reviews?clientId=xxx  (ADMIN ONLY)
  // ----------------------------------
  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;

    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      return res
        .status(400)
        .json({ ok: false, error: 'clientId query param is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reviews:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to fetch reviews' });
    }

    return res.status(200).json({ ok: true, reviews: data });
  }

  // ----------------------------------
  // POST /api/reviews  (PUBLIC – review form)
  // ----------------------------------
  if (req.method === 'POST') {
    const { clientId, name, rating, comments } = (req.body as any) || {};

    if (!clientId || typeof rating !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'clientId and numeric rating are required',
      });
    }

    // Validate client
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ ok: false, error: 'Invalid clientId' });
    }

    // Insert review
    const { data: review, error } = await supabaseAdmin
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
      return res.status(500).json({ ok: false, error: 'Failed to save review' });
    }

    const googleReviewLink = client.google_review_link || null;

    // Email business owner for low review (<=4)
    if (rating <= 4 && resendClient && client.owner_email) {
      try {
        await resendClient.emails.send({
          from: 'Sitrixx Reviews <reviews@sitrixx.app>',
          to: client.owner_email,
          subject: `New ${rating}-star feedback for ${client.business_name}`,
          html: `
            <p>You received a new internal review for <b>${client.business_name}</b>.</p>
            <p><b>Customer:</b> ${name || 'Anonymous'}</p>
            <p><b>Rating:</b> ${rating} / 5</p>
            <p><b>Comments:</b></p>
            <p>${comments || '(no comments provided)'}</p>
            <hr />
            <p>This review was captured privately by your Sitrixx system so you can improve before it impacts your public rating.</p>
          `,
        });
      } catch (emailError) {
        console.error('Error sending low-review email:', emailError);
      }
    }

    return res.status(201).json({
      ok: true,
      review,
      googleReviewLink: rating >= 5 ? googleReviewLink : null,
    });
  }

  // Unsupported method
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

