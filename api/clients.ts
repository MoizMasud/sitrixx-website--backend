import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';

// /api/clients
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS + preflight
  if (applyCors(req, res)) return;

  // -------------------------
  // GET /api/clients
  // -------------------------
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching clients:', error);
        return res.status(500).json({ ok: false, error: 'Failed to fetch clients' });
      }

      return res.status(200).json({ ok: true, clients: data });
    } catch (err) {
      console.error('Unexpected error fetching clients:', err);
      return res.status(500).json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // -------------------------
  // POST /api/clients
  // Create new client
  // -------------------------
  if (req.method === 'POST') {
    try {
      const {
        id,
        business_name,
        website_url,
        booking_link,
        google_review_link,
        owner_email,
        twilio_number,
        forwarding_phone,
        custom_sms_template,
      } = (req.body as any) || {};

      // Required fields
      if (!id || !business_name || !owner_email) {
        return res.status(400).json({
          ok: false,
          error: 'id, business_name, and owner_email are required'
        });
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
          forwarding_phone,
          custom_sms_template
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating client:', error);
        return res.status(500).json({ ok: false, error: 'Failed to create client' });
      }

      return res.status(201).json({ ok: true, client: data });
    } catch (err) {
      console.error('Unexpected error inserting client:', err);
      return res.status(500).json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // Unsupported method
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

