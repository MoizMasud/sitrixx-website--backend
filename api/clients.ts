// api/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';
import { requireAuth } from './_auth';

// /api/clients
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS + preflight
  if (applyCors(req, res)) return;

  // 🔐 Require JWT for ALL client operations
  const user = requireAuth(req, res);
  if (!user) return; // response already sent

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
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to fetch clients' });
      }

      return res.status(200).json({ ok: true, clients: data });
    } catch (err) {
      console.error('Unexpected error fetching clients:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // -------------------------
  // POST /api/clients  (create)
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

      if (!id || !business_name || !owner_email) {
        return res.status(400).json({
          ok: false,
          error: 'id, business_name, and owner_email are required',
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
          custom_sms_template,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating client:', error);
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to create client' });
      }

      return res.status(201).json({ ok: true, client: data });
    } catch (err) {
      console.error('Unexpected error creating client:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // -------------------------
  // PUT /api/clients  (update)
  // -------------------------
  if (req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const body: any = req.body || {};
      const { id, ...rest } = body;

      if (!id) {
        return res
          .status(400)
          .json({ ok: false, error: 'id is required to update a client' });
      }

      // Only allow specific fields to be updated
      const allowedFields = [
        'business_name',
        'website_url',
        'booking_link',
        'google_review_link',
        'owner_email',
        'twilio_number',
        'forwarding_phone',
        'custom_sms_template',
      ];

      const updates: Record<string, any> = {};

      for (const key of allowedFields) {
        if (rest[key] !== undefined) {
          updates[key] = rest[key];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'No updatable fields provided',
        });
      }

      const { data, error } = await supabaseAdmin
        .from('clients')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating client:', error);
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to update client' });
      }

      return res.status(200).json({ ok: true, client: data });
    } catch (err) {
      console.error('Unexpected error updating client:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // Fallback for unsupported methods
  res.setHeader('Allow', 'GET, POST, PUT, PATCH');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}



