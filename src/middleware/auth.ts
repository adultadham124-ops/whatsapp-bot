import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL in environment');
if (!anonKey) throw new Error('Missing SUPABASE_ANON_KEY in environment');

const supabaseAnon = createClient(supabaseUrl, anonKey);

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = header.replace('Bearer ', '');
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.userId = data.user.id;
    next();
  } catch {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.replace('Bearer ', '');
    supabaseAnon.auth.getUser(token).then(({ data }) => {
      if (data.user) req.userId = data.user.id;
      next();
    }).catch(() => next());
  } else {
    next();
  }
}
