import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../supabaseAdmin';
import { twilioClient, TWILIO_FROM_NUMBER } from '../twilioClient';
import { applyCors } from './_cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

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

  if (req.method === 'POST') {
    const { clientId, name, phone, email } = (req.body as any) || {};

    if (!clientId || !phone) {
      return res
        .status(400)
        .json({ ok: false, error: 'clientId and phone are required' });
    }

    // Load client to know settings + google link
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Invalid clientId:', clientError);
      return res.status(400).json({ ok: false, error: 'Invalid clientId' });
    }

    // Insert customer
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
      const smsBody = `Hey ${name || 'there'}, thanks for choosing ${bizName}! We’d really appreciate a quick Google review: ${client.google_review_link}`;
      const fromNumber = client.twilio_number || TWILIO_FROM_NUMBER;

      try {
        await twilioClient.messages.create({
          from: fromNumber,
          to: phone,
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
        console.error('Error sending auto review SMS:', smsError);
      }
    }

    return res.status(201).json({ ok: true, customer });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}
