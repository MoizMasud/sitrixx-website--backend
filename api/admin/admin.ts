// /api/admin.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { applyCors } from './_cors';

async function requireAdmin(req: VercelRequest) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { ok: false as const, status: 401, error: 'Missing bearer token' };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, status: 401, error: 'Invalid token' };

  const userId = userData.user.id;

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, email')
    .eq('id', userId)
    .single();

  if (profErr || !profile) return { ok: false as const, status: 403, error: 'No profile' };
  if (profile.role !== 'admin') return { ok: false as const, status: 403, error: 'Not admin' };

  return { ok: true as const, userId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  const guard = await requireAdmin(req);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });

  const { action, payload } = (req.body || {}) as { action?: string; payload?: any };
  if (!action) return res.status(400).json({ ok: false, error: 'Missing action' });

  try {
    // -------------------------
    // Clients (Businesses)
    // -------------------------
    if (action === 'listClients') {
      const { data, error } = await supabaseAdmin.from('clients').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ ok: true, clients: data });
    }

    if (action === 'createClient') {
      const { business_name, website_url, booking_link, google_review_link, twilio_number, forwarding_phone, custom_sms_template, review_sms_template, auto_review_enabled } = payload || {};
      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert([{
          business_name,
          website_url,
          booking_link,
          google_review_link,
          twilio_number,
          forwarding_phone,
          custom_sms_template,
          review_sms_template,
          auto_review_enabled: !!auto_review_enabled
        }])
        .select('*')
        .single();

      if (error) throw error;
      return res.status(200).json({ ok: true, client: data });
    }

    if (action === 'updateClient') {
      const { client_id, patch } = payload || {};
      const { data, error } = await supabaseAdmin
        .from('clients')
        .update({ ...patch })
        .eq('id', client_id)
        .select('*')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, client: data });
    }

    // -------------------------
    // Users + Assign to client
    // -------------------------
    if (action === 'listUsersForClient') {
      const { client_id } = payload || {};
      const { data, error } = await supabaseAdmin
        .from('client_users')
        .select('user_id, client_id, created_at, profiles:profiles(id,email,display_name,phone,role,needs_password_change)')
        .eq('client_id', client_id);

      if (error) throw error;
      return res.status(200).json({ ok: true, members: data });
    }

    if (action === 'createUserAndAssignClient') {
      const { email, display_name, phone, role, client_id } = payload || {};
      if (!email || !client_id) return res.status(400).json({ ok: false, error: 'email and client_id required' });

      // 1) create auth user (or fetch existing)
      // Try to find existing user by email (admin API doesn't have direct "get by email" in all setups),
      // simplest approach: attempt create; if it fails because exists, you handle separately.
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name }
      });

      let userId: string | null = created?.user?.id ?? null;

      // If user already exists, you’ll need a fallback:
      // easiest: in Supabase dashboard you can copy UID OR build a small admin table mapping email->id.
      // For now, bubble up the error cleanly.
      if (createErr || !userId) {
        return res.status(400).json({ ok: false, error: createErr?.message || 'Failed to create auth user' });
      }

      // 2) upsert profile
      const { error: profErr } = await supabaseAdmin.from('profiles').upsert([{
        id: userId,
        email,
        display_name: display_name ?? null,
        phone: phone ?? null,
        role: role ?? 'client',
        needs_password_change: true
      }]);
      if (profErr) throw profErr;

      // 3) link to client
      const { error: linkErr } = await supabaseAdmin.from('client_users').insert([{
        user_id: userId,
        client_id
      }]);
      if (linkErr) throw linkErr;

      return res.status(200).json({ ok: true, user_id: userId });
    }

    if (action === 'updateUserRoleOrClient') {
      const { user_id, client_id, profile_patch } = payload || {};

      if (profile_patch) {
        const { error } = await supabaseAdmin.from('profiles').update(profile_patch).eq('id', user_id);
        if (error) throw error;
      }

      if (client_id) {
        // move / reassign: simplest is delete existing and insert new
        await supabaseAdmin.from('client_users').delete().eq('user_id', user_id);
        const { error } = await supabaseAdmin.from('client_users').insert([{ user_id, client_id }]);
        if (error) throw error;
      }

      return res.status(200).json({ ok: true });
    }

    if (action === 'setNeedsPasswordChange') {
      const { user_id, value } = payload || {};
      const { error } = await supabaseAdmin.from('profiles').update({ needs_password_change: !!value }).eq('id', user_id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (e: any) {
    console.error('[admin]', e);
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
