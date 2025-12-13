// api/admin/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ ok: false, error: 'Missing auth header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    // 🔐 Admin check
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // ===============================
    // GET — list all clients
    // ===============================
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ ok: true, clients: data });
    }

    // ===============================
    // POST — create client
    // ===============================
    if (req.method === 'POST') {
      const {
        business_name,
        website_url,
        booking_link,
        google_review_link,
        twilio_number,
        forwarding_phone,
        custom_sms_template,
        review_sms_template,
        auto_review_enabled,
      } = req.body || {};

      if (!business_name) {
        return res.status(400).json({ ok: false, error: 'business_name required' });
      }

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({
          business_name,
          website_url,
          booking_link,
          google_review_link,
          twilio_number,
          forwarding_phone,
          custom_sms_template,
          review_sms_template,
          auto_review_enabled: !!auto_review_enabled,
        })
        .select('*')
        .single();

      if (error) throw error;
      return res.status(201).json({ ok: true, client: data });
    }

    // ===============================
    // PATCH — update client
    // ===============================
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body || {};
      if (!id) {
        return res.status(400).json({ ok: false, error: 'Client id required' });
      }

      const { data, error } = await supabaseAdmin
        .from('clients')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      return res.status(200).json({ ok: true, client: data });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('admin/clients error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error',
    });
  }
}
