import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient, TWILIO_FROM_NUMBER } from '../twilioClient';
import { applyCors } from './_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS + OPTIONS
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { clientId, name, phone } = (req.body as any) || {};

    if (!clientId || !phone) {
      return res
        .status(400)
        .json({ ok: false, error: 'clientId and phone are required' });
    }

    // Load client to get google_review_link + business_name + twilio_number
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ ok: false, error: 'Invalid clientId' });
    }

    const googleReviewLink: string | null = client.google_review_link || null;
    const bizName: string = client.business_name || 'our business';

    if (!googleReviewLink) {
      return res.status(400).json({
        ok: false,
        error: 'Client has no google_review_link configured',
      });
    }

    const smsBody = `Hey ${name || 'there'}, thanks for choosing ${bizName}! We’d really appreciate a quick Google review: ${googleReviewLink}`;

    const fromNumber = client.twilio_number || TWILIO_FROM_NUMBER;

    await twilioClient.messages.create({
      from: fromNumber,
      to: phone,
      body: smsBody,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error in /api/review-request:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
