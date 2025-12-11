// api/authHelpers.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET!;

export interface AuthUser {
  sub: string; // user id
  email?: string;
  user_metadata?: {
    is_admin?: boolean;
    client_id?: string;
  };
}

export function getAuthUser(req: VercelRequest): AuthUser | null {
  const auth = req.headers['authorization'] || '';
  const [, token] = auth.split(' '); // "Bearer xxx"
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

export function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
  opts?: { adminOnly?: boolean }
): AuthUser | null {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  if (opts?.adminOnly && !user.user_metadata?.is_admin) {
    res.status(403).json({ error: 'Admin only' });
    return null;
  }

  return user;
}
