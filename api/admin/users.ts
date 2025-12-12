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
  // CORS
  if (applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  // -------------------------
  // GET /api/admin/users
  // -------------------------
  if (req.method === 'GET') {
    try {
      // Supabase admin listUsers (paginates). We'll pull first 200 for now.
      const { data: usersData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });

      if (listErr) {
        console.error('Error listing auth users:', listErr);
        return res.status(500).json({ ok: false, error: 'Failed to list users' });
      }

      // Load profiles (role, display_name, phone) for these users
      const ids = (usersData?.users || []).map(u => u.id);

      const { data: profiles, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('id, role, display_name, phone, email, created_at')
        .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']); // safe empty

      if (profErr) {
        console.error('Error fetching profiles:', profErr);
        return res.status(500).json({ ok: false, error: 'Failed to fetch profiles' });
      }

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const users = (usersData?.users || []).map(u => {
        const p = profileMap.get(u.id);
        return {
          id: u.id,
          email: u.email,
          display_name: p?.display_name ?? u.user_metadata?.display_name ?? '',
          phone: p?.phone ?? u.user_metadata?.phone ?? '',
          role: p?.role ?? 'user',
          created_at: u.created_at || p?.created_at || null,
        };
      });

      return res.status(200).json({ ok: true, users });
    } catch (err) {
      console.error('Unexpected error listing users:', err);
      return res.status(500).json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // -------------------------
  // PATCH /api/admin/users (edit user/profile)
  // -------------------------
  if (req.method === 'PATCH') {
    try {
      const { user_id, display_name, phone, role, password } = (req.body as any) || {};

      if (!user_id) {
        return res.status(400).json({ ok: false, error: 'user_id is required' });
      }

      // Optional: prevent editing your own role accidentally
      // if (user_id === admin.callerId && role && role !== 'admin') {
      //   return res.status(400).json({ ok: false, error: 'Cannot demote yourself' });
      // }

      // 1) Update Auth user metadata / password (optional)
      const authUpdates: any = {};
      if (password) authUpdates.password = password;

      // Keep metadata in sync (optional, but nice)
      const meta: any = {};
      if (display_name !== undefined) meta.display_name = display_name;
      if (phone !== undefined) meta.phone = phone;
      if (Object.keys(meta).length) authUpdates.user_metadata = meta;

      if (Object.keys(authUpdates).length) {
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, authUpdates);
        if (updErr) {
          console.error('Error updating auth user:', updErr);
          return res.status(500).json({ ok: false, error: updErr.message || 'Failed to update auth user' });
        }
      }

      // 2) Update profiles table (display_name, phone, role)
      const profileUpdates: any = {};
      if (display_name !== undefined) profileUpdates.display_name = display_name;
      if (phone !== undefined) profileUpdates.phone = phone;
      if (role !== undefined) profileUpdates.role = role;

      if (Object.keys(profileUpdates).length) {
        const { error: profUpdErr } = await supabaseAdmin
          .from('profiles')
          .update(profileUpdates)
          .eq('id', user_id);

        if (profUpdErr) {
          console.error('Error updating profile:', profUpdErr);
          return res.status(500).json({ ok: false, error: profUpdErr.message || 'Failed to update profile' });
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Unexpected error updating user:', err);
      return res.status(500).json({ ok: false, error: 'Unexpected server error' });
    }
  }

  // -------------------------
  // DELETE /api/admin/users
  // -------------------------
  if (req.method === 'DELETE') {
    try {
      const { user_id } = (req.body as any) || {};
      if (!user_id) {
        return res.status(400).json({ ok: false, error: 'user_id is required' });
      }

      // Prevent self-delete (recommended)
      if (user_id === admin.callerId) {
        return res.status(400).json({ ok: false, error: 'Cannot delete your own account' });
      }

      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (delErr) {
        console.error('Error deleting user:', delErr);
        return res.status(500).json({ ok: false, error: delErr.message || 'Failed to delete user' });
      }

      // profiles row should cascade if FK is set, but this is safe:
      await supabaseAdmin.from('profiles').delete().eq('id', user_id);

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Unexpected error deleting user:', err);
      return res.status(500).json({ ok: false, error: 'Unexpected server error' });
    }
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE, OPTIONS');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}
