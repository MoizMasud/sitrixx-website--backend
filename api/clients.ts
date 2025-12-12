// /api/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';

// Helper: extract bearer token
function getBearerToken(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

// Helper: get authed user from token (mobile / web admin calls)
async function getAuthedUser(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function asBool(v: any): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
  }
  return undefined;
}

// /api/clients
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always run CORS first
  if (applyCors(req, res)) return;

  // -------------------------
  // GET /api/clients
  //   - default: returns ALL clients (keeps website/admin working)
  //   - mine=1: returns only clients linked to authed user via client_users
  // -------------------------
  if (req.method === 'GET') {
    try {
      const mine =
        req.query?.mine === '1' ||
        req.query?.mine === 'true' ||
        req.query?.scope === 'mine';

      // ✅ Mobile-safe mode (only return this user's clients)
      if (mine) {
        const user = await getAuthedUser(req);
        if (!user) {
          return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const { data: links, error: linkErr } = await supabaseAdmin
          .from('client_users')
          .select('client_id')
          .eq('user_id', user.id);

        if (linkErr) {
          console.error('Error fetching client_users:', linkErr);
          return res
            .status(500)
            .json({ ok: false, error: 'Failed to fetch user clients' });
        }

        const clientIds = (links || [])
          .map((x: any) => x.client_id)
          .filter(Boolean);

        if (clientIds.length === 0) {
          // important: return [] not error (lets app show empty state gracefully)
          return res.status(200).json({ ok: true, clients: [] });
        }

        const { data, error } = await supabaseAdmin
          .from('clients')
          .select('*')
          .in('id', clientIds)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching clients (mine):', error);
          return res
            .status(500)
            .json({ ok: false, error: 'Failed to fetch clients' });
        }

        return res.status(200).json({ ok: true, clients: data });
      }

      // ✅ Existing behavior (keeps website/admin working)
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
  // POST /api/clients (create)
  // - Generates UUID server-side
  // - Still accepts id if you want (backwards-compatible),
  //   but ignores empty/invalid ids safely.
  // NOTE: owner_email removed because column doesn't exist (your DB)
  // -------------------------
  if (req.method === 'POST') {
    try {
      const {
        id: maybeId,
        business_name,
        website_url,
        booking_link,
        google_review_link,
        twilio_number,
        forwarding_phone,
        custom_sms_template, // missed-call template
        review_sms_template, // Google review template
        auto_review_enabled,
      } = (req.body as any) || {};

      if (!business_name) {
        return res.status(400).json({
          ok: false,
          error: 'business_name is required',
        });
      }

      // ✅ always ensure we have an id
      const id =
        typeof maybeId === 'string' && maybeId.trim()
          ? maybeId.trim()
          : crypto.randomUUID();

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({
          id,
          business_name,
          website_url,
          booking_link,
          google_review_link,
          twilio_number,
          forwarding_phone,
          custom_sms_template,
          review_sms_template,
          auto_review_enabled: asBool(auto_review_enabled) ?? false,
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
  // PUT /api/clients (update)
  // PATCH /api/clients (partial update)
  // NOTE: owner_email removed from allowed fields (DB column missing)
  // -------------------------
  if (req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const body: any = req.body || {};
      const { id, ...rest } = body;

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: 'id is required to update a client',
        });
      }

      const allowedFields = [
        'business_name',
        'website_url',
        'booking_link',
        'google_review_link',
        'twilio_number',
        'forwarding_phone',
        'custom_sms_template', // missed-call template
        'review_sms_template', // Google review template
        'auto_review_enabled',
      ];

      const updates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (rest[key] !== undefined) updates[key] = rest[key];
      }

      // normalize boolean if present
      if (updates.auto_review_enabled !== undefined) {
        updates.auto_review_enabled = asBool(updates.auto_review_enabled);
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

  // -------------------------
  // DELETE /api/clients?id=CLIENT_ID
  // -------------------------
  if (req.method === 'DELETE') {
    try {
      const id = (req.query?.id as string) || (req.body?.id as string);

      if (!id) {
        return res
          .status(400)
          .json({ ok: false, error: 'id is required to delete a client' });
      }

      const { data, error } = await supabaseAdmin
        .from('clients')
        .delete()
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error deleting client:', error);
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to delete client' });
      }

      return res.status(200).json({ ok: true, client: data });
    } catch (err) {
      console.error('Unexpected error deleting client:', err);
      return res
        .status(500)
        .json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // Fallback for unsupported methods
  res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}



