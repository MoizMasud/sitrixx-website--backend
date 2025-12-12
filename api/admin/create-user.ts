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

function randomTempPassword(len = 14) {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function assertAdmin(sessionToken: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(sessionToken);
  if (userErr || !userData?.user) {
    return { ok: false as const, error: 'Invalid or expired session' };
  }

  const callerId = userData.user.id;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (profErr || !profile) return { ok: false as const, error: 'Forbidden (no profile)' };
  if (profile.role !== 'admin') return { ok: false as const, error: 'Forbidden (admin only)' };

  return { ok: true as const, callerId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const sessionToken = getBearerToken(req);
  if (!sessionToken) return res.status(401).json({ ok: false, error: 'Missing Authorization token' });

  const adminCheck = await assertAdmin(sessionToken);
  if (!adminCheck.ok) return res.status(403).json(adminCheck);

  const { email, role, display_name, phone, client_id } = (req.body || {}) as {
    email?: string;
    role?: 'admin' | 'client' | 'staff';
    display_name?: string;
    phone?: string;
    client_id?: string; // uuid
  };

  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

  const finalRole = role || 'client';
  const tempPassword = randomTempPassword();

  // 1) Create auth user
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createErr || !created?.user) {
    return res.status(500).json({ ok: false, error: createErr?.message || 'Failed to create auth user' });
  }

  const newUserId = created.user.id;

  // 2) Upsert profile
  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(
    {
      id: newUserId,
      role: finalRole,
      display_name: display_name || null,
      phone: phone || null,
      needs_password_change: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  // 3) Optional client assignment
  let clientAssignErrMsg: string | null = null;
  if (client_id) {
    const { error: mapErr } = await supabaseAdmin.from('client_users').insert({
      client_id,
      user_id: newUserId,
    });
    if (mapErr) clientAssignErrMsg = mapErr.message;
  }

  // If profile failed but user created: return ok + warning
  if (profileErr) {
    return res.status(200).json({
      ok: true,
      user_id: newUserId,
      temp_password: tempPassword,
      warning: 'User created but profile setup failed',
      profile_error: profileErr.message,
      client_assign_error: clientAssignErrMsg,
    });
  }

  return res.status(200).json({
    ok: true,
    user_id: newUserId,
    temp_password: tempPassword,
    client_assign_error: clientAssignErrMsg,
  });
}



