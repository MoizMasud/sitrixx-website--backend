import type { VercelRequest, VercelResponse } from '@vercel/node';

const allowedOrigin = '*';
// Later, change this to your real Webflow domain, e.g.
// const allowedOrigin = 'https://sitrixx.webflow.io';

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');

  // Echo back the requested headers if provided, otherwise allow common ones
  const requestHeaders =
    (req.headers['access-control-request-headers'] as string | undefined) ||
    'Content-Type, Authorization, Accept, Origin, X-Requested-With';

  res.setHeader('Access-Control-Allow-Headers', requestHeaders);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // stop the handler
  }

  return false;
}
