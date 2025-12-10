// api/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';

// GET /api/clients -> list all clients
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching clients:', error);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const {
      id,
      business_name,
      website_url,
      booking_link,
      google_review_link,
      owner_email,
      twilio_number,
    } = (req.body as any) || {};

    if (!id || !business_name || !owner_email) {
      return res
        .status(400)
        .json({ error: 'id, business_name, owner_email are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({
        id,
        business_name,
        website_url,
        booking_link,
        google_review_link,
        owner_email,
        twilio_number,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating client:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    return res.status(201).json(data);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
