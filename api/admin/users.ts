// api/admin/users.ts
// Single consolidated users API (list/create/update/delete) to avoid Vercel function-count limits.

import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: any) {
  const authHeader = (req.headers?.authorization || req.headers?.Authorization || '') as string;
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
}

async function requireAdmin(req: any) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return { ok: false as const, status: 401, error: 'Missing Authorization token' };
  }

  // Validate the caller token against Supabase Auth
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: 'Invalid or expired session' };
  }

  const callerId = userData.user.id;

  // Check role from profiles
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', callerId)
    .single();

  if (profErr || !profile) {
    return { ok: false as const, status: 403, error: 'Forbidden (no profile)' };
  }
  if (profile.role !== 'admin') {
    return { ok: false as const, status: 403, error: 'Forbidden (admin only)' };
  }

  return { ok: true as const, callerId };
}

function json(res: any, status: number, body: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function randomTempPassword() {
  // Simple temp password generator (client will reset/change later)
  // Includes upper/lower/number/symbol for typical password rules.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out + 'A1!';
}

export default async function handler(req: any, res: any) {
  // Always run CORS first
  if (applyCors(req, res)) return;

  try {
    // Admin gate for everything in this file
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return json(res, adminCheck.status, adminCheck);

    // -------------------------
    // GET: List users
    // GET /api/admin/users
    // Optional filters:
    //   ?role=client|admin|user
    //   ?client_id=<uuid>
    // -------------------------
    if (req.method === 'GET') {
      const role = (req.query?.role as string) || '';
      const clientId = (req.query?.client_id as string) || '';

      // With your FK fixes, this nested select should now work.
      // profiles -> client_users (via client_users.user_id -> profiles.id)
      // client_users -> clients (via client_users.client_id -> clients.id)
      let q = supabaseAdmin
        .from('profiles')
        .select(
          `
          id,
          email,
          display_name,
          phone,
          role,
          needs_password_change,
          created_at,
          updated_at,
          client_users (
            client_id,
            created_at,
            clients (
              id,
              business_name
            )
          )
        `
        )
        .order('created_at', { ascending: false });

      if (role) q = q.eq('role', role);
      if (clientId) q = q.eq('client_users.client_id', clientId);

      const { data, error } = await q;
      if (error) return json(res, 500, { ok: false, error: error.message });

      // Flatten client assignment for UI convenience
      const users = (data || []).map((p: any) => {
        const cu = Array.isArray(p.client_users) ? p.client_users[0] : null;
        const client = cu?.clients || null;

        return {
          id: p.id,
          email: p.email,
          display_name: p.display_name,
          phone: p.phone,
          role: p.role,
          needs_password_change: p.needs_password_change,
          created_at: p.created_at,
          updated_at: p.updated_at,
          client_id: cu?.client_id || null,
          client_name: client?.business_name || null,
        };
      });

      return json(res, 200, { ok: true, users });
    }

    // -------------------------
    // POST: Create user
    // POST /api/admin/users
    // Body:
    // {
    //   "email": "...",
    //   "role": "client" | "admin" | "user",
    //   "display_name": "...",
    //   "phone": "...",
    //   "client_id": "<uuid optional>",
    //   "temp_password": "<optional>"
    // }
    // -------------------------
    if (req.method === 'POST') {
      const body = req.body || {};
      const email = (body.email || '').trim().toLowerCase();
      const role = (body.role || 'client').trim();
      const display_name = body.display_name ? String(body.display_name).trim() : null;
      const phone = body.phone ? String(body.phone).trim() : null;
      const client_id = body.client_id ? String(body.client_id).trim() : null;

      if (!email) return json(res, 400, { ok: false, error: 'email is required' });

      const tempPassword = body.temp_password ? String(body.temp_password) : randomTempPassword();

      // 1) Create auth user
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      if (createErr || !created?.user) {
        return json(res, 500, { ok: false, error: createErr?.message || 'Failed to create auth user' });
      }

      const newUserId = created.user.id;

      // 2) Upsert profile
      const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
        {
          id: newUserId,
          email,
          role,
          display_name,
          phone,
          needs_password_change: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (profErr) {
        // Auth user exists, but profile failed
        return json(res, 200, {
          ok: true,
          warning: 'User created but profile setup failed',
          user_id: newUserId,
          temp_password: tempPassword,
          profile_error: profErr.message,
        });
      }

      // 3) Optional: assign to client (only if provided)
      if (client_id) {
        // If you only want client mappings for role === 'client', uncomment:
        // if (role !== 'client') { ... }

        // Ensure only one mapping per user: delete then insert
        await supabaseAdmin.from('client_users').delete().eq('user_id', newUserId);

        const { error: mapErr } = await supabaseAdmin.from('client_users').insert({
          user_id: newUserId,
          client_id,
        });

        if (mapErr) {
          return json(res, 200, {
            ok: true,
            warning: 'User created but client assignment failed',
            user_id: newUserId,
            temp_password: tempPassword,
            assignment_error: mapErr.message,
          });
        }
      }

      return json(res, 200, {
        ok: true,
        user_id: newUserId,
        temp_password: tempPassword, // show in UI once, then you can hide later
      });
    }

    // -------------------------
    // PATCH: Update user profile / role / client assignment
    // PATCH /api/admin/users?id=<userId>
    // Body can include:
    // { display_name?, phone?, role?, needs_password_change?, client_id? (uuid or null) }
    // -------------------------
    if (req.method === 'PATCH') {
      const userId = String(req.query?.id || '').trim();
      if (!userId) return json(res, 400, { ok: false, error: 'Missing ?id' });

      const body = req.body || {};
      const update: any = { updated_at: new Date().toISOString() };

      if (body.display_name !== undefined) update.display_name = body.display_name ? String(body.display_name).trim() : null;
      if (body.phone !== undefined) update.phone = body.phone ? String(body.phone).trim() : null;
      if (body.role !== undefined) update.role = String(body.role).trim();
      if (body.needs_password_change !== undefined) update.needs_password_change = !!body.needs_password_change;

      // Update profile fields
      const { error: updErr } = await supabaseAdmin.from('profiles').update(update).eq('id', userId);
      if (updErr) return json(res, 500, { ok: false, error: updErr.message });

      // Optional client assignment update
      if (body.client_id !== undefined) {
        const client_id = body.client_id ? String(body.client_id).trim() : null;

        // remove old mapping(s)
        await supabaseAdmin.from('client_users').delete().eq('user_id', userId);

        // set new mapping
        if (client_id) {
          const { error: mapErr } = await supabaseAdmin.from('client_users').insert({
            user_id: userId,
            client_id,
          });
          if (mapErr) return json(res, 500, { ok: false, error: mapErr.message });
        }
      }

      return json(res, 200, { ok: true });
    }

    // -------------------------
    // DELETE: Delete user
    // DELETE /api/admin/users?id=<userId>
    // Deletes mapping -> profile -> auth user
    // -------------------------
    if (req.method === 'DELETE') {
      const userId = String(req.query?.id || '').trim();
      if (!userId) return json(res, 400, { ok: false, error: 'Missing ?id' });

      // 1) Remove client mapping(s)
      await supabaseAdmin.from('client_users').delete().eq('user_id', userId);

      // 2) Remove profile
      await supabaseAdmin.from('profiles').delete().eq('id', userId);

      // 3) Remove auth user
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (delErr) return json(res, 500, { ok: false, error: delErr.message });

      return json(res, 200, { ok: true });
    }

    // Fallback
    res.setHeader('Allow', 'GET,POST,PATCH,DELETE,OPTIONS');
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message || 'Server error' });
  }
}


