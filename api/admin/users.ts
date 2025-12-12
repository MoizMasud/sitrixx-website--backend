// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (handles OPTIONS too)
  if (applyCors(req, res)) return;

  try {
    // 🔐 Verify auth
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

    // 🔐 Check admin role
    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // ===============================
    // GET — list users
    // ===============================
    if (req.method === 'GET') {
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
        throw error;
      }

      return res.status(200).json({ ok: true, users: profiles });
    }

    // ===============================
    // POST — create user
    // ===============================
    if (req.method === 'POST') {
      const { email, role = 'client' } = req.body;

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      // Temporary password
      const tempPassword = Math.random().toString(36).slice(-10);

      const { data: createdUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
        });

      if (createError || !createdUser.user) {
        throw createError;
      }

      // Create profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: createdUser.user.id,
          email,
          role,
          needs_password_change: true,
        });

      if (profileError) {
        throw profileError;
      }

      return res.status(201).json({
        ok: true,
        userId: createdUser.user.id,
      });
    }

    // ===============================
    // PATCH — update user
    // ===============================
    if (req.method === 'PATCH') {
      const { userId, display_name, phone, role } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          display_name,
          phone,
          role,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        throw error;
      }

      return res.status(200).json({ ok: true });
    }

    // ===============================
    // DELETE — delete user
    // ===============================
    if (req.method === 'DELETE') {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error',
    });
  }
}

