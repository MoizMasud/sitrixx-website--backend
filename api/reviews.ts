import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { resendClient } from '../resendClient';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId query param is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reviews:', error);
      return res.status(500).json({ error: 'Failed to fetch reviews' });
    }

    return res.status(200).json({ ok: true, reviews: data });
  }

  if (req.method === 'POST') {
    const { clientId, name, rating, comments } = (req.body as any) || {};

    if (!clientId || typeof rating !== 'number') {
      return res
        .status(400)
        .json({ error: 'clientId and numeric rating are required' });
    }

    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ error: 'Invalid clientId' });
    }

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
      return res.status(500).json({ error: 'Failed to save review' });
    }

    const googleReviewLink = client.google_review_link || null;

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
            <p>This review was captured privately by your Sitrixx system so you can improve the experience before it impacts your public rating.</p>
          `,
        });
      } catch (emailError) {
        console.error('Error sending review email:', emailError);
      }
    }

    return res.status(201).json({
      ok: true,
      review,
      googleReviewLink: rating >= 5 ? googleReviewLink : null,
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}


