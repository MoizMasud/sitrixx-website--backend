// api/_auth.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET!; // from Supabase

export type AuthUser = {
  sub: string;               // user id
  email?: string;
  role?: string;
  [key: string]: any;
};

export function requireAuth(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }

  const token = auth.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    return payload;
  } catch (err) {
    console.error('JWT verify failed', err);
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

