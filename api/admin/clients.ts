// api/admin/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  return authHeader.replace('Bearer ', '').trim() || null;
}

async function requireAdmin(req: VercelRequest, res: VercelResponse) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing auth header' });
    return null;
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return null;
  }

  const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (adminProfileErr) {
    console.error('[admin/clients] profile check error:', adminProfileErr);
    res.status(500).json({ ok: false, error: 'Failed to verify admin role' });
    return null;
  }

  if (adminProfile?.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin only' });
    return null;
  }

  return { userId: user.id };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    console.log('[admin/clients] HIT', { method: req.method, url: req.url });

    const admin = await requireAdmin(req, res);
    if (!admin) return;

    // ===============================
    // GET — list clients
    // ===============================
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[admin/clients] list error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to load clients',
          details: error.message,
        });
      }

      return res.status(200).json({
        ok: true,
        route: 'admin/clients',
        clients: data || [],
      });
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

      if (!business_name || !String(business_name).trim()) {
        return res.status(400).json({ ok: false, error: 'business_name required' });
      }

      // ✅ IMPORTANT: generate id in API (fixes "null value in column id" issues)
      const newId = crypto.randomUUID();

      const insertPayload = {
        id: newId,
        business_name: String(business_name).trim(),
        website_url: website_url ?? null,
        booking_link: booking_link ?? null,
        google_review_link: google_review_link ?? null,
        forwarding_phone: forwarding_phone ?? null,
        custom_sms_template: custom_sms_template ?? null,
        review_sms_template: review_sms_template ?? null,
        auto_review_enabled: typeof auto_review_enabled === 'boolean' ? auto_review_enabled : null,
      };

      console.log('[admin/clients] create payload', insertPayload);

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) {
        console.error('[admin/clients] create error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to create client',
          details: error.message, // 👈 shows the real reason
        });
      }

      return res.status(201).json({
        ok: true,
        route: 'admin/clients',
        client: data,
      });
    }

    // ===============================
    // PATCH — update client
    // ===============================
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'Client id required' });

      const updatePayload = { ...updates, updated_at: new Date().toISOString() };

      console.log('[admin/clients] update', { id, updatePayload });

      const { data, error } = await supabaseAdmin
        .from('clients')
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('[admin/clients] update error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to update client',
          details: error.message,
        });
      }

      return res.status(200).json({
        ok: true,
        route: 'admin/clients',
        client: data,
      });
    }

    // ===============================
    // DELETE — delete client (and related rows)
    // ===============================
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'Client id required' });

      console.log('[admin/clients] delete', { id });

      await supabaseAdmin.from('client_users').delete().eq('client_id', id);
      await supabaseAdmin.from('customer_contacts').delete().eq('client_id', id);
      await supabaseAdmin.from('leads').delete().eq('client_id', id);
      await supabaseAdmin.from('reviews').delete().eq('client_id', id);

      const { error } = await supabaseAdmin.from('clients').delete().eq('id', id);
      if (error) {
        console.error('[admin/clients] delete error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to delete client',
          details: error.message,
        });
      }

      return res.status(200).json({ ok: true, route: 'admin/clients' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed', route: 'admin/clients' });
  } catch (err: any) {
    console.error('[admin/clients] crash', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error',
      route: 'admin/clients',
    });
  }
}

