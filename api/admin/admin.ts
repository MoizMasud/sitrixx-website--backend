// /api/admin.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';

type AdminAction =
  | 'listClients'
  | 'createClient'
  | 'updateClient'
  | 'listClientUsers'
  | 'createUserAndAssignClient'
  | 'updateUserProfile'
  | 'moveUserToClient'
  | 'setNeedsPasswordChange';

async function requireAdmin(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return { ok: false as const, status: 401, error: 'Missing Authorization Bearer token' };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: 'Invalid token' };
  }

  const userId = userData.user.id;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, email')
    .eq('id', userId)
    .single();

  if (profErr || !profile) {
    return { ok: false as const, status: 403, error: 'Profile not found' };
  }

  if (profile.role !== 'admin') {
    return { ok: false as const, status: 403, error: 'Not an admin' };
  }

  return { ok: true as const, userId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  const guard = await requireAdmin(req);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });

  const { action, payload } = (req.body || {}) as { action?: AdminAction; payload?: any };
  if (!action) return res.status(400).json({ ok: false, error: 'Missing action' });

  try {
    // -------------------------
    // Clients (Businesses)
    // -------------------------
    if (action === 'listClients') {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ ok: true, clients: data });
    }

    if (action === 'createClient') {
      const insert = payload || {};
      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert([insert])
        .select('*')
        .single();

      if (error) throw error;
      return res.status(200).json({ ok: true, client: data });
    }

    if (action === 'updateClient') {
      const { client_id, patch } = payload || {};
      if (!client_id || !patch) return res.status(400).json({ ok: false, error: 'client_id and patch required' });

      const { data, error } = await supabaseAdmin
        .from('clients')
        .update(patch)
        .eq('id', client_id)
        .select('*')
        .single();

      if (error) throw error;
      return res.status(200).json({ ok: true, client: data });
    }

    // -------------------------
    // Users for a Client
    // -------------------------
    if (action === 'listClientUsers') {
      const { client_id } = payload || {};
      if (!client_id) return res.status(400).json({ ok: false, error: 'client_id required' });

      const { data, error } = await supabaseAdmin
        .from('client_users')
        .select(`
          user_id,
          client_id,
          created_at,
          profiles:profiles(
            id,email,display_name,phone,role,needs_password_change,created_at,updated_at
          )
        `)
        .eq('client_id', client_id);

      if (error) throw error;
      return res.status(200).json({ ok: true, users: data });
    }

    // Create Auth user + profile + assign to client
    if (action === 'createUserAndAssignClient') {
      const { email, display_name, phone, role, client_id } = payload || {};
      if (!email || !client_id) return res.status(400).json({ ok: false, error: 'email and client_id required' });

      // Create auth user
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name },
      });

      if (createErr || !created?.user?.id) {
        return res.status(400).json({ ok: false, error: createErr?.message || 'Failed to create user' });
      }

      const userId = created.user.id;

      // Upsert profile
      const { error: profErr } = await supabaseAdmin.from('profiles').upsert([{
        id: userId,
        email,
        display_name: display_name ?? null,
        phone: phone ?? null,
        role: role ?? 'client',
        needs_password_change: true,
      }]);
      if (profErr) throw profErr;

      // Assign to client
      const { error: linkErr } = await supabaseAdmin.from('client_users').insert([{
        user_id: userId,
        client_id,
      }]);
      if (linkErr) throw linkErr;

      return res.status(200).json({ ok: true, user_id: userId });
    }

    // Update profile fields (role/display_name/phone/etc)
    if (action === 'updateUserProfile') {
      const { user_id, patch } = payload || {};
      if (!user_id || !patch) return res.status(400).json({ ok: false, error: 'user_id and patch required' });

      const { error } = await supabaseAdmin.from('profiles').update(patch).eq('id', user_id);
      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    // Move user to a different client (reassign)
    if (action === 'moveUserToClient') {
      const { user_id, client_id } = payload || {};
      if (!user_id || !client_id) return res.status(400).json({ ok: false, error: 'user_id and client_id required' });

      // simplest: delete then insert
      await supabaseAdmin.from('client_users').delete().eq('user_id', user_id);
      const { error } = await supabaseAdmin.from('client_users').insert([{ user_id, client_id }]);
      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    if (action === 'setNeedsPasswordChange') {
      const { user_id, value } = payload || {};
      if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' });

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ needs_password_change: !!value })
        .eq('id', user_id);

      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (e: any) {
    console.error('[admin]', e);
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
