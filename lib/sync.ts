import NetInfo from '@react-native-community/netinfo';
import { getPendingSales, markSaleSynced } from './offlineDb';
import { supabase } from './supabase';
import { getShopId } from './settings';

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
    const shopId = await getShopId();
    for (const rec of pending) {
      try {
        if (!supabase) throw new Error('Supabase not configured');
        // insert receipt row (same structure used by handleCharge)
        await supabase.from('transaction_receipts').insert(rec.data);
        // call stock deduction RPC with shop id
        await supabase.rpc('deduct_stock', {
          shop_id: shopId,
          items: rec.data.items,
        });
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
