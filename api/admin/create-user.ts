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

async function requireAdmin(req: VercelRequest, res: VercelResponse) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    res.status(401).json({ ok: false, error: 'Missing Authorization token' });
    return null;
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

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
      return res.status(400).json({ ok: false, error: 'email and password are required' });
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
      return res.status(500).json({ ok: false, error: error?.message || 'Failed to create user' });
    }

    const newUserId = data.user.id;

    // 2) Upsert profile (ONLY fields that you are sure exist in your profiles table)
    const profilePayload: Record<string, any> = {
      id: newUserId,
      role,
      needs_password_change: true,
    };

    // Only include these if your profiles table has them
    if (display_name) profilePayload.display_name = display_name;
    if (phone) profilePayload.phone = phone;
    if (client_id) profilePayload.client_id = client_id;

    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });

    if (profileErr) {
      console.error('Profile upsert failed:', profileErr);

      // Optional cleanup: delete auth user so you don’t end up with orphan users
      try {
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
      } catch (cleanupErr) {
        console.error('Cleanup deleteUser failed:', cleanupErr);
      }

      return res.status(500).json({
        ok: false,
        error: 'User created but profile setup failed',
        debug: {
          message: (profileErr as any).message,
          details: (profileErr as any).details,
          hint: (profileErr as any).hint,
          code: (profileErr as any).code,
        },
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




