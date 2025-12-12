// api/admin/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

function getBearerToken(req: VercelRequest) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
}

async function assertAdmin(sessionToken: string) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(sessionToken);
  if (userErr || !userData?.user) return { ok: false as const, error: 'Invalid or expired session' };
  const callerId = userData.user.id;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (profErr || !profile) return { ok: false as const, error: 'Forbidden (no profile)' };
  if (profile.role !== 'admin') return { ok: false as const, error: 'Forbidden (admin only)' };

  return { ok: true as const };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const sessionToken = getBearerToken(req);
  if (!sessionToken) return res.status(401).json({ ok: false, error: 'Missing Authorization token' });

  const adminCheck = await assertAdmin(sessionToken);
  if (!adminCheck.ok) return res.status(403).json(adminCheck);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(`
      id,
      role,
      display_name,
      phone,
      needs_password_change,
      created_at,
      updated_at,
      client_users (
        client_id,
        clients ( id, business_name )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.status(200).json({ ok: true, users: data });
}
