import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load Environment Variables
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || SUPABASE_URL.includes('your_supabase_url_here')) {
  console.error('⚠️ Critical Warning: Supabase Server credentials are not configured in your .env file.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false, // Server client should not persist session locally
    autoRefreshToken: false
  }
});
