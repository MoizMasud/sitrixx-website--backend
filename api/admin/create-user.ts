// api/admin/create-user.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from '../api/_cors'; // ✅ if path fails, change to "../_cors"

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  return authHeader.replace('Bearer ', '').trim();
}

function isAuthorized(req: VercelRequest) {
  const token = getBearerToken(req);
  return !!token && !!process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS first (handles OPTIONS and returns true)
  if (applyCors(req, res)) return;

  // Safety: allow OPTIONS to exit cleanly even if applyCors changes later
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Admin guard (do NOT run this on OPTIONS)
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

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

