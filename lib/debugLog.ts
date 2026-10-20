import { supabase } from './supabase';

const device = 'atouch-tablet';

export function dlog(stage: string) {
  console.log('[STAGE]', stage);
  supabase
    .from('debug_logs')
    .insert({ device, stage })
    .then(() => {}, () => {}); // never await, never throw
}
