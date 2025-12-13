// api/admin/client-users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../supabaseAdmin';
import { applyCors } from '../_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    // Only GET supported
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // 🔐 Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ ok: false, error: 'Missing auth header' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ ok: false, error: 'Invalid token' });

    // 🔐 Check admin role
    const { data: adminProfile, error: adminProfileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (adminProfileErr) {
      console.error('Error fetching admin profile:', adminProfileErr);
      return res.status(500).json({
        ok: false,
        error: 'Failed to verify admin role',
        details: adminProfileErr.message,
      });
    }

    if (adminProfile?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }

    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : null;
    if (!clientId) {
      return res.status(400).json({ ok: false, error: 'clientId required' });
    }

    // 1) Get linked user IDs
    const { data: links, error: linkErr } = await supabaseAdmin
      .from('client_users')
      .select('user_id')
      .eq('client_id', clientId);

    if (linkErr) {
      console.error('Error loading client_users:', linkErr);
      return res.status(500).json({ ok: false, error: 'Failed to load users', details: linkErr.message });
    }

    const userIds = (links || []).map((r: any) => r.user_id).filter(Boolean);

    // none linked
    if (!userIds.length) {
      return res.status(200).json({ ok: true, users: [] });
    }

    // 2) Fetch profiles
    const { data: profiles, error: profErr } = await supabaseAdmin
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
      .in('id', userIds)
      .order('created_at', { ascending: false });

    if (profErr) {
      console.error('Error loading profiles:', profErr);
      return res.status(500).json({ ok: false, error: 'Failed to load users', details: profErr.message });
    }

    return res.status(200).json({ ok: true, users: profiles || [] });
  } catch (err: any) {
    console.error('admin/client-users error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error', details: err?.message || String(err) });
  }
}
