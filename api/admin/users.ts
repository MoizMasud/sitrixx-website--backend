// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

type Role = 'admin' | 'client' | 'client_owner';

function getBearerToken(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

function makeTempPassword() {
  // 12+ chars, includes upper/lower/number/symbol (avoids policy issues)
  const base = Math.random().toString(36).slice(-10);
  return `Tmp!${base}9A`;
}

function isValidUUID(v: any) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (handles OPTIONS too)
  if (applyCors(req, res)) return;

  try {
    // 🔐 Verify auth
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing auth header' });
    }

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
      console.error('Error reading admin profile:', adminProfileErr);
      return res.status(500).json({ ok: false, error: 'Failed to verify admin role' });
    }

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // ===============================
    // GET — list users
    // ===============================
    if (req.method === 'GET') {
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
        console.error('Error listing profiles:', error);
        return res.status(500).json({ ok: false, error: 'Failed to list users' });
      }

      return res.status(200).json({ ok: true, users: profiles });
    }

    // ===============================
    // POST — create user + profile + optional link to client
    // ===============================
    if (req.method === 'POST') {
      const {
        email,
        password, // optional: if omitted, temp password used
        role = 'client',
        clientId, // optional but recommended: link user to a business
        display_name,
        phone,
      } = (req.body as any) || {};

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      if (clientId !== undefined && clientId !== null && !isValidUUID(clientId)) {
        return res.status(400).json({ ok: false, error: 'clientId must be a UUID' });
      }

      const finalPassword =
        typeof password === 'string' && password.trim().length >= 8
          ? password.trim()
          : makeTempPassword();

      // 1) Create auth user
      const { data: created, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: finalPassword,
          email_confirm: true,
        });

      if (createError || !created?.user) {
        // Make it obvious what happened
        const msg = createError?.message || 'Failed to create auth user';
        console.error('auth.admin.createUser failed:', createError);
        // Common: "User already registered"
        if (msg.toLowerCase().includes('already')) {
          return res.status(409).json({
            ok: false,
            error: 'User already exists',
          });
        }
        return res.status(500).json({
          ok: false,
          error: msg,
        });
      }

      const newUserId = created.user.id;

      // 2) Create profile row
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: newUserId,
        email,
        role: role as Role,
        display_name: display_name ?? null,
        phone: phone ?? null,
        needs_password_change: !password, // if admin didn't supply password, force change
      });

      if (profileError) {
        console.error('profiles insert failed:', profileError);

        // cleanup: remove auth user to avoid half-created accounts
        try {
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
        } catch (cleanupErr) {
          console.error('cleanup deleteUser failed:', cleanupErr);
        }

        return res.status(500).json({
          ok: false,
          error: profileError.message || 'Failed to create profile',
        });
      }

      // 3) Link to client (optional but usually needed)
      if (clientId) {
        const { error: linkErr } = await supabaseAdmin.from('client_users').insert({
          user_id: newUserId,
          client_id: clientId,
        });

        if (linkErr) {
          console.error('client_users insert failed:', linkErr);

          // Keep the user but tell UI link failed (admin can retry)
          return res.status(201).json({
            ok: true,
            userId: newUserId,
            tempPassword: password ? undefined : finalPassword,
            warning: 'User created but failed to link user to client',
          });
        }
      }

      // If admin didn't provide password, return temp so you can share it once
      return res.status(201).json({
        ok: true,
        userId: newUserId,
        tempPassword: password ? undefined : finalPassword,
      });
    }

    // ===============================
    // PATCH — update user profile
    // ===============================
    if (req.method === 'PATCH') {
      const { userId, display_name, phone, role } = (req.body as any) || {};

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
        console.error('profiles update failed:', error);
        return res.status(500).json({ ok: false, error: error.message || 'Failed to update user' });
      }

      return res.status(200).json({ ok: true });
    }

    // ===============================
    // DELETE — delete user
    // ===============================
    if (req.method === 'DELETE') {
      const { userId } = (req.body as any) || {};

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Remove mappings first (avoids FK issues if present)
      await supabaseAdmin.from('client_users').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('admin/users fatal:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error',
    });
  }
}


