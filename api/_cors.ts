// api/_cors.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// For now you can leave this as '*'.
// When you move to production you can change it to your Webflow domain:
//   const ALLOWED_ORIGIN = 'https://sitrixx.webflow.io';
const ALLOWED_ORIGIN =
  process.env.CORS_ORIGIN || '*';

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  // Core CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );

  // Preflight request – reply and stop
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  // Continue to handler
  return false;
}
