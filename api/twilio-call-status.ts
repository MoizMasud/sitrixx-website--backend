// api/twilio-call-status.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient } from '../twilioClient';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const body = req.body as any;

  const dialStatus = body.DialCallStatus || body.CallStatus;
  const fromNumber = body.From || body.Caller; // caller's phone
  const toNumber = body.To;                    // your Twilio number

  console.log('Call status callback BODY:', body);
  console.log('Parsed status:', { dialStatus, fromNumber, toNumber });

  // For now, treat ANY callback as something we want to log + notify.
  // (Later we can refine to only no-answer/busy/failed.)
  if (!fromNumber || !toNumber) {
    console.error('Missing From or To in call status callback');
    return res.status(200).send('Missing data');
  }

  // Find which client this Twilio number belongs to
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('twilio_number', toNumber)
    .single();

  if (error || !client) {
    console.error('No client found for Twilio number (status callback):', toNumber, error);
    return res.status(200).send('Client not found');
  }

  // Save call as a lead (source = missed_call for now)
  try {
    await supabaseAdmin.from('leads').insert({
      client_id: client.id,
      name: null,
      phone: fromNumber,
      email: null,
      message: `Call ended with status: ${dialStatus || 'unknown'}`,
      source: 'missed_call',
    });
  } catch (leadErr) {
    console.error('Error saving call lead:', leadErr);
  }

  // Build SMS body (you can later add a custom template for this)
  const bizName = client.business_name || 'our team';
  const bookingLink = client.booking_link || '';
  let smsBody = `Sorry we missed your call at ${bizName}.`;

  if (bookingLink) {
    smsBody += ` You can book a time here: ${bookingLink}`;
  } else {
    smsBody += ` Reply to this text and we'll get back to you soon.`;
  }

  // Send SMS back to caller
  try {
    await twilioClient.messages.create({
      from: client.twilio_number,
      to: fromNumber,
      body: smsBody,
    });
  } catch (smsErr) {
    console.error('Error sending missed call SMS:', smsErr);
  }

  return res.status(200).send('OK');
}

