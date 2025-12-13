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
    // Optional: ?clientId=<uuid> -> users assigned to that client
    // ===============================
    if (req.method === 'GET') {
      const clientId =
        typeof req.query.clientId === 'string' ? req.query.clientId : null;

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
          console.error('Error listing users for client:', error);
          return res
            .status(500)
            .json({ ok: false, error: 'Failed to load users' });
        }

        // Return only the profile objects (what the mobile UI wants)
        return res.status(200).json({
          ok: true,
          users: (data || [])
            .map((r: any) => r.profiles)
            .filter(Boolean),
        });
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
        return res
          .status(500)
          .json({ ok: false, error: 'Failed to load users' });
      }

      return res.status(200).json({ ok: true, users: profiles });
    }

    // ===============================
    // POST — create user
    // Body:
    //  - email (required)
    //  - role (optional, default 'client')
    //  - clientId (optional) -> will link in client_users for mobile "mine" queries
    //  - tempPassword (optional) -> if not provided, we auto-generate
    // ===============================
    if (req.method === 'POST') {
      const { email, role = 'client', clientId, tempPassword } = req.body || {};

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      // Temporary password (min 8 chars)
      const generatedTemp = Math.random().toString(36).slice(-10);
      const finalTempPassword =
        typeof tempPassword === 'string' && tempPassword.length >= 8
          ? tempPassword
          : generatedTemp;

      // 1) Create auth user
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

      // 3) Optionally link user -> client (mobile app uses this to resolve "mine")
      if (clientId) {
        // If you have a unique constraint on (user_id, client_id), upsert is safest
        const { error: linkError } = await supabaseAdmin
          .from('client_users')
          .upsert(
            { user_id: newUserId, client_id: clientId },
            { onConflict: 'user_id,client_id' },
          );

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
        tempPassword: finalTempPassword, // you can hide this later if you prefer
        linkedClientId: clientId || null,
      });
    }

    // ===============================
    // PATCH — update user profile fields
    // ===============================
    if (req.method === 'PATCH') {
      const { userId, display_name, phone, role } = req.body || {};

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
        console.error('Error updating user profile:', error);
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

      // Clean up linking rows first (avoid FK issues)
      await supabaseAdmin.from('client_users').delete().eq('user_id', userId);

      // Then delete profile row
      await supabaseAdmin.from('profiles').delete().eq('id', userId);

      // Then delete auth user
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




