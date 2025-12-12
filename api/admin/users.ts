// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    // -----------------------------
    // Auth guard (admin only)
    // -----------------------------
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing auth header' });
    }

    const {
      data: { user: authedUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authedUser) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', authedUser.id)
      .single();

    if (adminProfileErr) {
      console.error('profiles select error:', adminProfileErr);
      return res.status(500).json({
        ok: false,
        step: 'verifyAdmin',
        error: adminProfileErr.message,
        code: adminProfileErr.code,
        details: adminProfileErr.details,
        hint: adminProfileErr.hint,
      });
    }

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    // -----------------------------
    // GET — list users
    // -----------------------------
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
        console.error('profiles list error:', error);
        return res.status(500).json({
          ok: false,
          step: 'listUsers',
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
      }

      return res.status(200).json({ ok: true, users: profiles });
    }

    // -----------------------------
    // POST — create user (email+temp password) + profile + link to client
    // -----------------------------
    if (req.method === 'POST') {
      const body = (req.body as any) || {};
      const { email, password, role = 'client', clientId, display_name, phone } = body;

      if (!email) {
        return res.status(400).json({ ok: false, error: 'Email required' });
      }

      if (!password || String(password).trim().length < 8) {
        return res.status(400).json({
          ok: false,
          error: 'Password required (min 8 characters)',
        });
      }

      // 1) Create auth user
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: String(email).trim(),
          password: String(password).trim(),
          email_confirm: true,
        });

      if (createErr || !created?.user) {
        console.error('auth.admin.createUser error:', createErr);

        // Helpful special case
        const msg = createErr?.message || 'Failed to create user';
        if (msg.toLowerCase().includes('already')) {
          return res.status(409).json({ ok: false, step: 'createUser', error: 'User already exists' });
        }

        return res.status(500).json({
          ok: false,
          step: 'createUser',
          error: msg,
          code: (createErr as any)?.code,
          details: (createErr as any)?.details,
        });
      }

      const newUserId = created.user.id;

      // 2) Create profile row (force change later)
      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
        id: newUserId,
        email: String(email).trim(),
        role,
        display_name: display_name ?? null,
        phone: phone ?? null,
        needs_password_change: true,
      });

      if (profileErr) {
        console.error('profiles insert error:', profileErr);

        // cleanup auth user so we don’t leave half-created accounts
        try {
          await supabaseAdmin.auth.admin.deleteUser(newUserId);
        } catch (cleanupErr) {
          console.error('cleanup deleteUser failed:', cleanupErr);
        }

        return res.status(500).json({
          ok: false,
          step: 'insertProfile',
          error: profileErr.message,
          code: profileErr.code,
          details: profileErr.details,
          hint: profileErr.hint,
        });
      }

      // 3) Link to client (so mobile "mine" works)
      if (clientId) {
        const { error: linkErr } = await supabaseAdmin.from('client_users').insert({
          user_id: newUserId,
          client_id: clientId,
        });

        if (linkErr) {
          console.error('client_users insert error:', linkErr);
          // don’t fail the whole creation; user exists, just not linked
          return res.status(201).json({
            ok: true,
            userId: newUserId,
            warning: 'User created but failed to link user to client',
            step: 'linkClient',
            linkError: {
              message: linkErr.message,
              code: linkErr.code,
              details: linkErr.details,
              hint: linkErr.hint,
            },
          });
        }
      }

      return res.status(201).json({ ok: true, userId: newUserId });
    }

    // -----------------------------
    // PATCH — update user profile
    // -----------------------------
    if (req.method === 'PATCH') {
      const { userId, display_name, phone, role } = (req.body as any) || {};
      if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

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
        console.error('profiles update error:', error);
        return res.status(500).json({
          ok: false,
          step: 'updateProfile',
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
      }

      return res.status(200).json({ ok: true });
    }

    // -----------------------------
    // DELETE — delete user
    // -----------------------------
    if (req.method === 'DELETE') {
      const { userId } = (req.body as any) || {};
      if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

      await supabaseAdmin.from('client_users').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('admin/users fatal:', err);
    return res.status(500).json({
      ok: false,
      step: 'fatal',
      error: err?.message || 'Internal server error',
    });
  }
}


