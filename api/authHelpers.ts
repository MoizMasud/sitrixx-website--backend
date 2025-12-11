// api/_auth.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt, { JwtPayload } from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export interface AuthUserPayload extends JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
}

/**
 * Verifies Supabase JWT from Authorization: Bearer <token>
 * Returns the decoded payload or null (and sends proper HTTP error).
 */
export function requireAuth(
  req: VercelRequest,
  res: VercelResponse
): AuthUserPayload | null {
  if (!JWT_SECRET) {
    console.error('SUPABASE_JWT_SECRET is not set');
    res
      .status(500)
      .json({ ok: false, error: 'Server auth misconfiguration' });
    return null;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.substring('Bearer '.length)
    : '';

  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing Authorization header' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
    return decoded;
  } catch (err) {
    console.error('JWT verification failed:', err);
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    return null;
  }
}


