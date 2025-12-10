// api/leads.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient, TWILIO_FROM_NUMBER } from '../twilioClient';

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

      let smsBody = `Hey${name ? ` ${name}` : ''}, thanks for reaching out to ${bizName}.`;

      if (bookingLink) {
        smsBody += ` You can book a time here: ${bookingLink}`;
      } else {
        smsBody += ` We'll get back to you shortly.`;
      }

      try {
        await twilioClient.messages.create({
          from: TWILIO_FROM_NUMBER,
          to: phone,
          body: smsBody,
        });
      } catch (smsError) {
        console.error('Error sending SMS:', smsError);
        // Don't fail the whole request just because SMS failed
      }
    }

    return res.status(201).json({ ok: true, lead });
  } catch (err) {
    console.error('Invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
}

