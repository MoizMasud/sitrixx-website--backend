// api/_cors.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  if (origin.endsWith('.webflow.io')) return true;
  if (origin.endsWith('.webflow.com')) return true;
  if (origin === 'https://sitrixx.ca') return true;
  if (origin === 'https://www.sitrixx.ca') return true;
  if (origin === 'https://sitrixx.com') return true;
  if (origin === 'https://www.sitrixx.com') return true; 
  return false;
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers.origin as string) || '';

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
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

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
