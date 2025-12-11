// api/_cors.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// You can tighten this later to your Webflow domain:
// const allowedOrigin = 'https://sitrixx.webflow.io';
const allowedOrigin = '*';

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // caller should stop
  }

  return false; // caller should continue
}
