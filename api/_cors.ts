import type { VercelRequest, VercelResponse } from '@vercel/node';

const allowedOrigin = '*'; 
// later you can set this to your Webflow domain, e.g.
// const allowedOrigin = 'https://sitrixx.webflow.io';

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // If it's a preflight request, respond here and stop
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}
