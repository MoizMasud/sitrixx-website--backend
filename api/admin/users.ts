// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

type AuthedAdmin = { id: string };

function getBearerToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  return authHeader.replace('Bearer ', '').trim() || null;
}

async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<AuthedAdmin | null> {
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
    console.error('Error fetching admin profile:', adminProfileErr);
    res.status(500).json({ ok: false, error: 'Failed to verify admin role' });
    return null;
  }

  if (adminProfile?.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin only' });
    return null;
  }

  return { id: user.id };
}

function normalizeEmail(email: any): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length ? e : null;
}

function safeString(v: any): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (handles OPTIONS too)
  if (applyCors(req, res)) return;

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    // ===============================
    // GET — list users
    // Optional: ?clientId=<uuid> -> users assigned to that client
    // ===============================
    if (req.method === 'GET') {
      const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : null;

      // If clientId is provided, return users for that client via client_users join
      if (clientId) {
        const { data, error } = await supabaseAdmin
          .from('client_users')
          .select(
            `
            user_id,
            client_id,
            profiles:profiles(
              id,
              email,
              display_name,
              phone,
              role,
              needs_password_change,
              created_at
            )
          `,
          )
          .eq('client_id', clientId);

        if (error) {
          console.error('Error listing users for client:', { clientId, error });
          return res.status(500).json({ ok: false, error: 'Failed to load users' });
        }

        const users = (data || [])
          .map((r: any) => r.profiles)
          .filter(Boolean)
          // optional: newest first if created_at exists
          .sort((a: any, b: any) => {
            const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
            return tb - ta;
          });

        return res.status(200).json({ ok: true, users });
      }

      // Default: list all users (profiles)
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select(
          `
          id,
          email,
          display_name,
          phone,
          role,
          created_at,
          needs_password_change
        `,
        )
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error listing users:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load users' });
      }

      return res.status(200).json({ ok: true, users: profiles || [] });
    }

    // ===============================
    // POST — create user
    // Body:
    //  - email (required)
    //  - role (optional, default 'client')  (you can keep backend support)
    //  - clientId (optional) -> link in client_users
    //  - tempPassword (optional) -> if not provided, auto-generate
    // ===============================
    if (req.method === 'POST') {
      const rawEmail = req.body?.email;
      const email = normalizeEmail(rawEmail);

      // keep role support but clamp to known values
      const roleRaw = safeString(req.body?.role) || 'client';
      const role = roleRaw === 'admin' ? 'admin' : 'client';

      const clientId = safeString(req.body?.clientId);
      const tempPassword = safeString(req.body?.tempPassword);

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      // Temporary password (min 8 chars)
      const generatedTemp = Math.random().toString(36).slice(-10);
      const finalTempPassword = tempPassword && tempPassword.length >= 8 ? tempPassword : generatedTemp;

      // 1) Create auth user
      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: finalTempPassword,
        email_confirm: true,
      });

      if (createError || !createdUser?.user) {
        console.error('createUser error:', createError);
        return res.status(500).json({
          ok: false,
          step: 'createUser',
          code: (createError as any)?.code,
          error: createError?.message || 'Database error creating new user',
        });
      }

      const newUserId = createdUser.user.id;

      // 2) Create/Update profile safely (avoids duplicate key if you have a trigger)
      const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
        {
          id: newUserId,
          email,
          role,
          needs_password_change: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

      if (profileError) {
        console.error('profile upsert error:', profileError);
        return res.status(500).json({
          ok: false,
          step: 'createProfile',
          error: profileError.message || 'Failed to create profile',
        });
      }

      // 3) Optionally link user -> client
      if (clientId) {
        const { error: linkError } = await supabaseAdmin
          .from('client_users')
          .upsert({ user_id: newUserId, client_id: clientId }, { onConflict: 'user_id,client_id' });

        if (linkError) {
          console.error('client_users upsert error:', linkError);
          return res.status(500).json({
            ok: false,
            step: 'linkClient',
            error: linkError.message || 'Failed to link user to client',
          });
        }
      }

      return res.status(201).json({
        ok: true,
        userId: newUserId,
        tempPassword: finalTempPassword,
        linkedClientId: clientId || null,
      });
    }

    // ===============================
    // PATCH — update user profile fields
    // ===============================
    if (req.method === 'PATCH') {
      const userId = safeString(req.body?.userId);
      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const display_name = req.body?.display_name ?? undefined;
      const phone = req.body?.phone ?? undefined;

      // keep role supported, but optional
      const roleRaw = req.body?.role;
      const role = roleRaw === 'admin' ? 'admin' : roleRaw === 'client' ? 'client' : undefined;

      const updatePayload: any = {
        updated_at: new Date().toISOString(),
      };
      if (display_name !== undefined) updatePayload.display_name = display_name;
      if (phone !== undefined) updatePayload.phone = phone;
      if (role !== undefined) updatePayload.role = role;

      const { error } = await supabaseAdmin.from('profiles').update(updatePayload).eq('id', userId);

      if (error) {
        console.error('Error updating user profile:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update user' });
      }

      return res.status(200).json({ ok: true });
    }

    // ===============================
    // DELETE — delete user
    // ===============================
    if (req.method === 'DELETE') {
      const userId = safeString(req.body?.userId);
      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Clean up linking rows first (avoid FK issues)
      const { error: linkErr } = await supabaseAdmin.from('client_users').delete().eq('user_id', userId);
      if (linkErr) console.warn('Warning deleting client_users links:', linkErr);

      const { error: profileErr } = await supabaseAdmin.from('profiles').delete().eq('id', userId);
      if (profileErr) console.warn('Warning deleting profile:', profileErr);

      const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authDelErr) {
        console.error('Error deleting auth user:', authDelErr);
        return res.status(500).json({ ok: false, error: 'Failed to delete auth user' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('admin/users error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error',
    });
  }
}




