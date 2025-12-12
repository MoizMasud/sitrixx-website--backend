// api/admin/create-user.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from '../api/_cors'; // adjust if your path is different

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  return token;
}

function isAdminUser(user: any) {
  const roleFromAppMeta = user?.app_metadata?.role;
  const roleFromUserMeta = user?.user_metadata?.role;
  return roleFromAppMeta === 'admin' || roleFromUserMeta === 'admin';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS first
  if (applyCors(req, res)) return;

  // Always allow OPTIONS
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Verify Supabase session token
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: 'Missing Authorization token' });
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);

  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
  }

  // Admin check
  if (!isAdminUser(userData.user)) {
    return res.status(403).json({ ok: false, error: 'Forbidden (admin only)' });
  }

  // Create user
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

