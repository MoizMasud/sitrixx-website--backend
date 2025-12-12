// api/_cors.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

function isAllowedOrigin(origin: string) {
  if (!origin) return false;

  // Allow Webflow hosted + Designer domains (covers sitrixx.design.webflow.com + *.app.webflow.io)
  if (/^https:\/\/([a-z0-9-]+\.)*webflow\.io$/i.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*webflow\.com$/i.test(origin)) return true;

  // Allow your real domains
  if (origin === 'https://sitrixx.ca') return true;
  if (origin === 'https://www.sitrixx.ca') return true;

  return false;
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers.origin as string) || '';

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}
