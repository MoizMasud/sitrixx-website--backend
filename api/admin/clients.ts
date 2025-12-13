// api/admin/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing auth header' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

    const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfileErr) {
      console.error('Error fetching admin profile:', adminProfileErr);
      return res.status(500).json({ ok: false, error: 'Failed to verify admin role' });
    }

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // ===============================
    // GET — list clients
    // ===============================
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error listing clients:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load clients' });
      }

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
          website_url: website_url ?? null,
          booking_link: booking_link ?? null,
          google_review_link: google_review_link ?? null,
          forwarding_phone: forwarding_phone ?? null,
          custom_sms_template: custom_sms_template ?? null,
          review_sms_template: review_sms_template ?? null,
          auto_review_enabled: typeof auto_review_enabled === 'boolean' ? auto_review_enabled : null,
        })
        .select('*')
        .single();

      if (error) {
        console.error('Error creating client:', error);
        return res.status(500).json({ ok: false, error: 'Failed to create client' });
      }

      return res.status(201).json({ ok: true, client: data });
    }

    // ===============================
    // PATCH — update client
    // ===============================
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'Client id required' });

      const { data, error } = await supabaseAdmin
        .from('clients')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('Error updating client:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update client' });
      }

      return res.status(200).json({ ok: true, client: data });
    }

    // ===============================
    // DELETE — delete client (and related rows)
    // ===============================
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'Client id required' });

      // remove links first to avoid FK violations
      await supabaseAdmin.from('client_users').delete().eq('client_id', id);
      await supabaseAdmin.from('customer_contacts').delete().eq('client_id', id);
      await supabaseAdmin.from('leads').delete().eq('client_id', id);
      await supabaseAdmin.from('reviews').delete().eq('client_id', id);

      const { error } = await supabaseAdmin.from('clients').delete().eq('id', id);
      if (error) {
        console.error('Error deleting client:', error);
        return res.status(500).json({ ok: false, error: 'Failed to delete client' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('admin/clients error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}


