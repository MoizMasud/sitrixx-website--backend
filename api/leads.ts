// api/leads.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { clientId, name, phone, email, message, source } = (req.body as any) || {};

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    // Make sure the client exists
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ error: 'Invalid clientId' });
    }

    // Save the lead
    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert({
        client_id: clientId,
        name,
        phone,
        email,
        message,
        source: source || 'website_form',
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting lead:', error);
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    // 🔜 later: send SMS here with Twilio + email notification to owner

    return res.status(201).json({ ok: true, lead: data });
  } catch (err) {
    console.error('Invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
}
