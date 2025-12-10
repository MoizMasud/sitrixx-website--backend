import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient, TWILIO_FROM_NUMBER } from '../twilioClient';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // GET /api/leads?clientId=moiz-test
    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId query param is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching leads:', error);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    return res.status(200).json({ ok: true, leads: data });
  }

  if (req.method === 'POST') {
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
    const { data: lead, error } = await supabaseAdmin
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

    // 🔔 Try to send SMS if we have a phone number
    if (phone) {
      const bizName = client.business_name || 'our team';
      const bookingLink = client.booking_link || '';

      const template =
        client.custom_sms_template ||
        'Hey {name}, thanks for contacting {business}. You can book here: {booking}';

      const smsBody = template
        .replace('{name}', name || '')
        .replace('{business}', bizName)
        .replace('{booking}', bookingLink);

      const fromNumber = client.twilio_number || TWILIO_FROM_NUMBER;

      try {
        await twilioClient.messages.create({
          from: fromNumber,
          to: phone,
          body: smsBody,
        });
      } catch (smsError) {
        console.error('Error sending SMS:', smsError);
      }
    }

    return res.status(201).json({ ok: true, lead });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

