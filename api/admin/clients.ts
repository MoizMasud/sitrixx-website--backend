// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

/**
 * Helper: load users linked to a specific client (business)
 * Uses 2 queries (NO JOIN) to avoid PostgREST relationship issues.
 */
async function getUsersForClient(clientId: string) {
  // 1) Fetch linked user IDs
  const { data: links, error: linksErr } = await supabaseAdmin
    .from('client_users')
    .select('user_id')
    .eq('client_id', clientId);

  if (linksErr) {
    throw linksErr;
  }

  const userIds = (links || [])
    .map((r: any) => r.user_id)
    .filter(Boolean);

  if (userIds.length === 0) {
    return [];
  }

  // 2) Fetch user profiles
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select(`
      id,
      email,
      display_name,
      phone,
      role,
      created_at,
      needs_password_change
    `)
    .in('id', userIds)
    .order('created_at', { ascending: false });

  if (profilesErr) {
    throw profilesErr;
  }

  return profiles || [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    // ===============================
    // 🔐 Auth
    // ===============================
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ ok: false, error: 'Missing auth header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    // ===============================
    // 🔐 Admin role check
    // ===============================
    const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfileErr) {
      console.error('Error fetching admin profile:', adminProfileErr);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to verify admin role' });
    }

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // ===============================
    // GET — list users
    // Optional: ?clientId=xxx
    // ===============================
    if (req.method === 'GET') {
      const clientId =
        typeof req.query.clientId === 'string' ? req.query.clientId : null;

      // ✅ Client-specific users (isolated logic)
      if (clientId) {
        try {
          const users = await getUsersForClient(clientId);
          return res.status(200).json({ ok: true, users });
        } catch (err) {
          console.error('getUsersForClient failed:', err);
          return res
            .status(500)
            .json({ ok: false, error: 'Failed to load users' });
        }
      }

      // ✅ Default behavior (UNCHANGED)
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select(`
          id,
          email,
          display_name,
          phone,
          role,
          created_at,
          needs_password_change
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error listing users:', error);
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to load users' });
      }

      return res.status(200).json({ ok: true, users: profiles });
    }

    // ===============================
    // POST — create user
    // ===============================
    if (req.method === 'POST') {
      const { email, role = 'client', clientId, tempPassword } = req.body || {};

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      const generatedTemp = Math.random().toString(36).slice(-10);
      const finalTempPassword =
        typeof tempPassword === 'string' && tempPassword.length >= 8
          ? tempPassword
          : generatedTemp;

      const { data: createdUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: finalTempPassword,
          email_confirm: true,
        });

      if (createError || !createdUser?.user) {
        console.error('createUser error:', createError);
        return res.status(500).json({
          ok: false,
          error: createError?.message || 'Failed to create user',
        });
      }

      const newUserId = createdUser.user.id;

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
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to create profile' });
      }

      if (clientId) {
        const { error: linkError } = await supabaseAdmin
          .from('client_users')
          .upsert(
            { user_id: newUserId, client_id: clientId },
            { onConflict: 'user_id,client_id' },
          );

        if (linkError) {
          console.error('client_users upsert error:', linkError);
          return res
            .status(500)
            .json({ ok: false, error: 'Failed to link user to client' });
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
    // PATCH — update user
    // ===============================
    if (req.method === 'PATCH') {
      const { userId, display_name, phone } = req.body || {};

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          display_name,
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('Error updating user:', error);
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to update user' });
      }

      return res.status(200).json({ ok: true });
    }

    // ===============================
    // DELETE — delete user
    // ===============================
    if (req.method === 'DELETE') {
      const { userId } = req.body || {};

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      await supabaseAdmin.from('client_users').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);

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


