// api/reviews.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { resendClient } from '../resendClient';

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

    // If rating is 5★ (or 4–5, your choice) → send them to Google
    // If rating is <= 4 → send private email to owner with feedback
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
        // don't fail the whole request if email fails
      }
    }

    // Response for the frontend:
    // - if rating >= 5, we return the Google link so UI can show "Leave a Google review" button
    // - if rating <= 4, we do NOT push them to Google
    return res.status(201).json({
      ok: true,
      review,
      googleReviewLink: rating >= 5 ? googleReviewLink : null,
    });
  } catch (err) {
    console.error('Invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
}

