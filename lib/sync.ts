import NetInfo from '@react-native-community/netinfo';
import { getPendingSales, markSaleSynced } from './offlineDb';
import { supabase } from './supabase';
import { getPosId } from './settings';

let syncing = false;

export function initSync() {
  // trigger on mount and whenever we regain connectivity
  NetInfo.addEventListener((state: any) => {
    if (state.isConnected) {
      syncSalesQueue();
    }
  });
  syncSalesQueue();
}

export async function syncSalesQueue() {
  if (syncing) return;
  syncing = true;
  try {
    const pending = await getPendingSales();
    if (pending.length === 0) return;
    const posId = await getPosId();
    console.log('syncSalesQueue: posId', posId, 'pending', pending.length);
    for (const rec of pending) {
      try {
        if (!supabase) throw new Error('Supabase not configured');
        if (posId) {
          // call POS sale RPC; backend will subtract inventory for the
          // specified shop_id.  we pass order identifier too for logging.
          await supabase.rpc('handle_pos_sale', {
            p_shop_id: posId,
            p_items: rec.data.items,
            p_order_id: rec.data.orderId || rec.data.order_id,
            p_total_amount: rec.data.total || rec.data.amount || 0,
            p_payment_method: rec.data.payment_method || 'Cash',
          });
        } else {
          console.warn('syncSalesQueue: no shop_id, skipping handle_pos_sale');
        }
        await markSaleSynced(rec.id);
      } catch (err) {
        console.warn('Failed to sync sale', rec.id, err);
        // we leave it pending for next attempt
      }
    }
  } catch (e) {
    console.warn('sync queue failed', e);
  } finally {
    syncing = false;
  }
}
