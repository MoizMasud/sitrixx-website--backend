// resendClient.ts
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn('RESEND_API_KEY is not set – email sending will be disabled.');
}

export const resendClient = apiKey ? new Resend(apiKey) : null;
