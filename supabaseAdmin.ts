// src/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// This client is ONLY for server-side use (never send this key to the browser)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
