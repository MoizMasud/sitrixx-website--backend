// api/admin/delete-user.ts
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

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const sessionToken = getBearerToken(req);
  if (!sessionToken) return res.status(401).json({ ok: false, error: 'Missing Authorization token' });

  const adminCheck = await assertAdmin(sessionToken);
  if (!adminCheck.ok) return res.status(403).json(adminCheck);

  const { user_id } = (req.body || {}) as { user_id?: string };
  if (!user_id) return res.status(400).json({ ok: false, error: 'Missing user_id' });

  // remove mappings + profile then auth user
  await supabaseAdmin.from('client_users').delete().eq('user_id', user_id);
  await supabaseAdmin.from('profiles').delete().eq('id', user_id);

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);
  if (delErr) return res.status(500).json({ ok: false, error: delErr.message });

  return res.status(200).json({ ok: true });
}
