// /api/review-request.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient, TWILIO_FROM_NUMBER } from '../twilioClient';
import { applyCors } from './_cors';

const DEFAULT_REVIEW_TEMPLATE =
  'Hi {{name}}, thanks for choosing {{business_name}}! ' +
  'It would mean a lot if you could leave us a quick review here: {{review_link}}';

// Normalize to E.164 for North America (default +1)
const normalizePhone = (raw: string): string => {
  if (!raw) return raw;

  const trimmed = raw.trim();

  // If user already gave us +..., trust it
  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  // Strip everything that's not a digit
  const digits = trimmed.replace(/\D/g, '');

  // 10 digits -> assume North America -> +1XXXXXXXXXX
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 -> +1XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Fallback: return original trimmed
  return trimmed;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { clientId, name, phone } = (req.body as any) || {};

    if (!clientId || !phone) {
      return res.status(400).json({
        ok: false,
        error: 'clientId and phone are required',
      });
    }

    // Load client to get templates + google link
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId in review-request:', clientError);
      return res.status(400).json({ ok: false, error: 'Invalid clientId' });
    }

    if (!client.google_review_link) {
      return res.status(400).json({
        ok: false,
        error:
          'No Google review link configured for this client. Please add one in Review Requests settings.',
      });
    }

    const bizName = client.business_name || 'our business';
    const reviewLink: string = client.google_review_link;

    // Use per-client template if available, otherwise fallback
    const rawTemplate: string =
      client.review_sms_template || DEFAULT_REVIEW_TEMPLATE;

    const smsBody = rawTemplate
      .replace(/{{name}}/g, name || 'there')
      .replace(/{{business_name}}/g, bizName)
      .replace(/{{review_link}}/g, reviewLink);

    const fromNumber: string =
      client.twilio_number || TWILIO_FROM_NUMBER;
    const toNumber = normalizePhone(phone);

    // Send SMS via Twilio
    await twilioClient.messages.create({
      from: fromNumber,
      to: toNumber,
      body: smsBody,
    });

    // Optionally find the customer row and bump counters
    try {
      const { data: existingCustomer } = await supabaseAdmin
        .from('customer_contacts')
        .select('*')
        .eq('client_id', clientId)
        .eq('phone', phone) // phone stored as user entered it
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingCustomer) {
        await supabaseAdmin
          .from('customer_contacts')
          .update({
            last_review_request_at: new Date().toISOString(),
            review_request_count:
              (existingCustomer.review_request_count || 0) + 1,
          })
          .eq('id', existingCustomer.id);
      }
    } catch (updateErr) {
      console.error('Error updating review_request_count (manual):', updateErr);
    }

    return res.status(200).json({ ok: true, sent: true });
  } catch (err) {
    console.error('Unexpected error in /api/review-request:', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Unexpected server error' });
  }
}

