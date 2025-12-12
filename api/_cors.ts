// api/_cors.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Optional: lock to a specific origin in prod, e.g.
// CORS_ORIGIN=https://sitrixx.webflow.io  (or your custom domain)
const FIXED_ORIGIN = process.env.CORS_ORIGIN || '';

function isWebflowOrigin(origin: string) {
  return origin.endsWith('.webflow.io');
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers.origin as string) || '';

  // Decide which origin to allow
  // 1) If you set CORS_ORIGIN, allow only that
  // 2) Otherwise allow Webflow preview domains (*.webflow.io)
  let allowOrigin = '';
  if (FIXED_ORIGIN) {
    if (origin === FIXED_ORIGIN) allowOrigin = origin;
  } else {
    if (isWebflowOrigin(origin)) allowOrigin = origin;
  }

  // If allowed, set CORS headers
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
  }

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
    // Important: return CORS headers on preflight too
    return res.status(200).end(), true;
  }

  // Continue to handler
  return false;
}
