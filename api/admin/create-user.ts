

// api/admin/create-user.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
}

/**
 * Validates:
 * - Caller has a valid Supabase session token (Authorization: Bearer <access_token>)
 * - Caller is admin (profiles.role === 'admin')
 */
async function requireAdmin(req: VercelRequest, res: VercelResponse) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    res.status(401).json({ ok: false, error: 'Missing Authorization token' });
    return null;
  }

  // Validate session token -> get caller user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    return null;
  }

  const callerId = userData.user.id;

  // Check caller role from profiles
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (applyCors(req, res)) return;

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Admin auth
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const body: any = req.body || {};

    const email = (body.email || '').trim().toLowerCase();
    const password = body.password;
    const display_name = body.display_name ?? body.displayName ?? '';
    const phone = body.phone ?? '';
    const role = body.role ?? 'user';
    const client_id = body.client_id ?? body.clientId ?? null;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: 'email and password are required',
      });
    }

    // 1) Create Auth user
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: display_name || '',
        phone: phone || '',
      },
    });

    if (error || !data?.user) {
      console.error('Error creating auth user:', error);
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to create user',
      });
    }

    const newUserId = data.user.id;

    // 2) Ensure profile exists + set role + set password-change flag
    // ✅ upsert prevents "profile missing" failures
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          email,
          role,
          display_name: display_name || '',
          phone: phone || '',
          client_id,
          needs_password_change: true, // ✅ force change on first login
        },
        { onConflict: 'id' }
      );

    if (profileErr) {
      console.error('Profile upsert failed:', profileErr);
      return res.status(500).json({
        ok: false,
        error: 'User created but profile setup failed',
      });
    }

    return res.status(201).json({
      ok: true,
      user: {
        id: newUserId,
        email: data.user.email,
        role,
        client_id,
        needs_password_change: true,
        created_at: data.user.created_at,
      },
    });
  } catch (err: any) {
    console.error('Unexpected error creating user:', err);
    return res.status(500).json({ ok: false, error: 'Unexpected server error' });
  }
}



