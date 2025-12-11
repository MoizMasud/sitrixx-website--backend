// /api/customers.ts
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

  // --------------------------------
  // GET /api/customers?clientId=xxx
  // --------------------------------
  if (req.method === 'GET') {
    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      return res
        .status(400)
        .json({ ok: false, error: 'clientId query param is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('customer_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching customers:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to fetch customers' });
    }

    return res.status(200).json({ ok: true, customers: data });
  }

  // ---------------------------
  // POST /api/customers (create)
  // ---------------------------
  if (req.method === 'POST') {
    const { clientId, name, phone, email } = (req.body as any) || {};

    if (!clientId || !phone) {
      return res
        .status(400)
        .json({ ok: false, error: 'clientId and phone are required' });
    }

    // Load client to know settings + google link + templates
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ ok: false, error: 'Invalid clientId' });
    }

    // Insert customer (store phone as user entered it)
    const { data: customer, error } = await supabaseAdmin
      .from('customer_contacts')
      .insert({
        client_id: clientId,
        name,
        phone,
        email,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating customer:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to create customer' });
    }

    // If auto_review_enabled, send review SMS immediately
    if (client.auto_review_enabled && client.google_review_link) {
      const bizName = client.business_name || 'our business';
      const reviewLink = client.google_review_link as string;

      // Review template can be overridden per client
      const rawTemplate: string =
        client.review_sms_template || DEFAULT_REVIEW_TEMPLATE;

      const smsBody = rawTemplate
        .replace(/{{name}}/g, name || 'there')
        .replace(/{{business_name}}/g, bizName)
        .replace(/{{review_link}}/g, reviewLink);

      const fromNumber: string =
        client.twilio_number || TWILIO_FROM_NUMBER;
      const toNumber = normalizePhone(phone);

      try {
        await twilioClient.messages.create({
          from: fromNumber,
          to: toNumber,
          body: smsBody,
        });

        await supabaseAdmin
          .from('customer_contacts')
          .update({
            last_review_request_at: new Date().toISOString(),
            review_request_count: (customer.review_request_count || 0) + 1,
          })
          .eq('id', customer.id);
      } catch (smsError) {
        // We don't fail the whole request if SMS sending fails
        console.error('Error sending auto review SMS:', smsError);
      }
    }

    return res.status(201).json({ ok: true, customer });
  }

  // ---------------------------
  // PUT/PATCH /api/customers (update)
  // ---------------------------
  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { id, name, phone, email } = (req.body as any) || {};

    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: 'id is required to update a customer' });
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No updatable fields provided',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('customer_contacts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating customer:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to update customer' });
    }

    return res.status(200).json({ ok: true, customer: data });
  }

  // ---------------------------
  // DELETE /api/customers
  // ---------------------------
  if (req.method === 'DELETE') {
    const { id } = (req.body as any) || {};

    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: 'id is required to delete a customer' });
    }

    const { error } = await supabaseAdmin
      .from('customer_contacts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting customer:', error);
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to delete customer' });
    }

    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}



