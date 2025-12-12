// /api/clients.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
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

// Helper: best-effort UUID (Node 18+ on Vercel supports crypto.randomUUID)
function makeUuid() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  if (crypto?.randomUUID) return crypto.randomUUID();

  // Fallback (very unlikely needed)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  // ✅ auto-generates UUID if id not provided
  // ✅ optionally links creating authed user to the new client
  //
  // How linking works:
  // - if linkUser=1 (or linkUser=true) OR linkUser is missing (default true),
  //   and a Bearer token is provided,
  //   we insert into client_users(user_id, client_id)
  //
  // NOTE:
  // - does NOT require owner_email (column doesn't exist)
  // -------------------------
  if (req.method === 'POST') {
    try {
      const body = (req.body as any) || {};
      const {
        id: providedId,
        business_name,
        website_url,
        booking_link,
        google_review_link,
        twilio_number,
        forwarding_phone,
        custom_sms_template, // missed-call template
        review_sms_template, // Google review template
        auto_review_enabled,
        // optional flags
        linkUser, // boolean-ish
      } = body;

      if (!business_name) {
        return res.status(400).json({
          ok: false,
          error: 'business_name is required',
        });
      }

      const newClientId = (providedId && String(providedId).trim()) || makeUuid();

      const { data: client, error: insertErr } = await supabaseAdmin
        .from('clients')
        .insert({
          id: newClientId,
          business_name,
          website_url,
          booking_link,
          google_review_link,
          twilio_number,
          forwarding_phone,
          custom_sms_template,
          review_sms_template,
          auto_review_enabled,
        })
        .select()
        .single();

      if (insertErr) {
        console.error('Error creating client:', insertErr);
        return res.status(500).json({
          ok: false,
          error: insertErr.message || 'Failed to create client',
          code: (insertErr as any).code,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        });
      }

      // Optional: link the creating authed user to this client (default true)
      const shouldLink =
        linkUser === undefined ||
        linkUser === null ||
        linkUser === true ||
        linkUser === 'true' ||
        linkUser === 1 ||
        linkUser === '1';

      if (shouldLink) {
        const user = await getAuthedUser(req);

        // Only link if there is an authed user (keeps website anonymous calls safe)
        if (user?.id) {
          const { error: linkErr } = await supabaseAdmin
            .from('client_users')
            .insert({ user_id: user.id, client_id: newClientId });

          if (linkErr) {
            console.error('Error linking user to client:', linkErr);
            // Don't fail creation — return warning so UI can show it
            return res.status(201).json({
              ok: true,
              client,
              warning:
                'Client created, but failed to link user to client (client_users insert failed).',
              linkError: {
                message: linkErr.message,
                code: linkErr.code,
                details: linkErr.details,
                hint: linkErr.hint,
              },
            });
          }
        }
      }

      return res.status(201).json({ ok: true, client });
    } catch (err: any) {
      console.error('Unexpected error creating client:', err);
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Unexpected server error',
      });
    }
  }

  // -------------------------
  // PUT /api/clients (update)
  // PATCH /api/clients (partial update)
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

      if (Object.keys(updates).length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: 'No updatable fields provided' });
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

      // optional: cleanup links (safe)
      await supabaseAdmin.from('client_users').delete().eq('client_id', id);

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



