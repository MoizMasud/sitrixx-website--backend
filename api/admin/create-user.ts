// api/admin/create-user.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // 1) Identify the caller (Supabase session token)
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: 'Missing Authorization token' });
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
  }

  const callerId = userData.user.id;

  // 2) Check role from profiles table
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (profErr || !profile) {
    return res.status(403).json({ ok: false, error: 'Forbidden (no profile)' });
  }

  if (profile.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Forbidden (admin only)' });
  }

  // 3) Create the new user
  try {
    const { email, password, display_name, phone } = (req.body as any) || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password are required' });
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: display_name || '',
        phone: phone || '',
      },
    });

    if (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Failed to create user' });
    }

    return res.status(201).json({
      ok: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
        created_at: data.user?.created_at,
      },
    });
  } catch (err) {
    console.error('Unexpected error creating user:', err);
    return res.status(500).json({ ok: false, error: 'Unexpected server error' });
  }
}


