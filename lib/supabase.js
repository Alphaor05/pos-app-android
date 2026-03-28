import { createClient } from '@supabase/supabase-js'

// Expo requires the EXPO_PUBLIC_ prefix for env vars to be available
// on the client side (Metro bundler only exposes EXPO_PUBLIC_* variables).
// Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
// to your Replit Secrets with the same values as your Supabase project.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Add these to your Replit Secrets to connect to your database.'
  )
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export async function handlePosSale(params) {
  if (!supabase) {
    const msg = '[Supabase] handlePosSale called without client';
    console.error(msg);
    return { data: null, error: new Error(msg) };
  }

  try {
    const { data, error } = await supabase.rpc('handle_pos_sale', params);
    if (error) {
      console.error('[Supabase] handle_pos_sale RPC error:', error);
      return { data, error };
    }
    console.debug('[Supabase] handle_pos_sale RPC success:', data);
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] handle_pos_sale RPC exception:', err);
    return { data: null, error: err };
  }
}

export async function insertTransactionReceipt(receipt) {
  if (!supabase) {
    const msg = '[Supabase] insertTransactionReceipt called without client';
    console.error(msg);
    return { data: null, error: new Error(msg) };
  }

  try {
    const { data, error } = await supabase.from('transaction_receipts').insert(receipt);
    if (error) {
      console.error('[Supabase] transaction_receipts insert error:', error);
      return { data, error };
    }
    console.debug('[Supabase] transaction_receipts insert success:', data);
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] transaction_receipts insert exception:', err);
    return { data: null, error: err };
  }
}
