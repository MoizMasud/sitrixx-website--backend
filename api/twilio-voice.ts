// api/twilio-voice.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  // Twilio sends form-encoded data: From, To, etc.
  const { From, To } = (req.body as any) || {};

  console.log('Incoming call From:', From, 'To:', To);

  // Look up which client this Twilio number belongs to
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('twilio_number', To)
    .single();

  // Default fallback – if something is wrong, just hang up
  if (error || !client) {
    console.error('No client found for Twilio number:', To, error);
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<Response><Hangup/></Response>`);
  }

  const forwardingPhone = client.forwarding_phone;
  if (!forwardingPhone) {
    console.error('No forwarding phone set for client:', client.id);
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<Response><Hangup/></Response>`);
  }

  // Status callback URL for when the dial finishes (answered / missed)
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : ''; // in prod Vercel sets this

  const statusCallbackUrl = `${baseUrl}/api/twilio-call-status`;

  const twiml = `
<Response>
  <Dial action="${statusCallbackUrl}" method="POST">
    ${forwardingPhone}
  </Dial>
</Response>`.trim();

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml);
}
