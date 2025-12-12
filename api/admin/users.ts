// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
}

async function assertAdmin(req: VercelRequest, res: VercelResponse) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing Authorization token' });
    return null;
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    return null;
  }

  const callerId = userData.user.id;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (profErr || !profile) {
    res.status(403).json({ ok: false, error: 'Forbidden (no profile)' });
    return null;
  }

  if (profile.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Forbidden (admin only)' });
    return null;
  }

  return { callerId };
}

function randomTempPassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await assertAdmin(req, res);
  if (!admin) return;

  // -------------------------
  // GET /api/admin/users (list)
  // -------------------------
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select(
        `
        id,
        role,
        display_name,
        phone,
        needs_password_change,
        created_at,
        updated_at,
        client_users (
          client_id,
          clients ( id, business_name )
        )
      `
      )
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, users: data });
  }

  // Parse body once for other methods
  const body: any = req.body || {};
  const action = body.action as string | undefined;

  // -------------------------
  // POST /api/admin/users (create OR send_reset)
  // -------------------------
  if (req.method === 'POST') {
    // Send password reset email
    if (action === 'send_reset') {
      const email = (body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: 'sitrixx://reset-password',
      });

      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Create user
    const email = (body.email || '').trim().toLowerCase();
    const role = (body.role || 'client') as 'admin' | 'client' | 'staff';
    const display_name = body.display_name ?? null;
    const phone = body.phone ?? null;
    const client_ids = Array.isArray(body.client_ids) ? body.client_ids : [];

    if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

    const temp_password = randomTempPassword();

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
    });

    if (createErr || !created?.user) {
      return res.status(500).json({ ok: false, error: createErr?.message || 'Failed to create user' });
    }

    const user_id = created.user.id;

    // profile upsert
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
      {
        id: user_id,
        role,
        display_name,
        phone,
        needs_password_change: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (profErr) {
      // Rollback auth user to avoid orphan
      await supabaseAdmin.auth.admin.deleteUser(user_id);
      return res.status(500).json({ ok: false, error: `Profile upsert failed: ${profErr.message}` });
    }

    // Optional client assignment (many-to-many)
    if (client_ids.length) {
      const rows = client_ids.map((cid: string) => ({ user_id, client_id: cid }));
      const { error: mapErr } = await supabaseAdmin.from('client_users').insert(rows);
      if (mapErr) {
        // still created, but warn
        return res.status(200).json({ ok: true, user_id, temp_password, warning: mapErr.message });
      }
    }

    return res.status(200).json({ ok: true, user_id, temp_password });
  }

  // -------------------------
  // PATCH /api/admin/users (update)
  // -------------------------
  if (req.method === 'PATCH') {
    const user_id = body.user_id;
    if (!user_id) return res.status(400).json({ ok: false, error: 'Missing user_id' });

    const patch: any = {};
    if (body.role !== undefined) patch.role = body.role;
    if (body.display_name !== undefined) patch.display_name = body.display_name;
    if (body.phone !== undefined) patch.phone = body.phone;
    patch.updated_at = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin.from('profiles').update(patch).eq('id', user_id);
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    // Optional replace client mappings
    if (Array.isArray(body.client_ids)) {
      await supabaseAdmin.from('client_users').delete().eq('user_id', user_id);
      if (body.client_ids.length) {
        const rows = body.client_ids.map((cid: string) => ({ user_id, client_id: cid }));
        const { error: mapErr } = await supabaseAdmin.from('client_users').insert(rows);
        if (mapErr) return res.status(500).json({ ok: false, error: mapErr.message });
      }
    }

    return res.status(200).json({ ok: true });
  }

  // -------------------------
  // DELETE /api/admin/users (delete)
  // -------------------------
  if (req.method === 'DELETE') {
    const user_id = body.user_id;
    if (!user_id) return res.status(400).json({ ok: false, error: 'Missing user_id' });

    if (user_id === admin.callerId) {
      return res.status(400).json({ ok: false, error: 'Cannot delete your own account' });
    }

    await supabaseAdmin.from('client_users').delete().eq('user_id', user_id);
    await supabaseAdmin.from('profiles').delete().eq('id', user_id);

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (delErr) return res.status(500).json({ ok: false, error: delErr.message });

    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}

