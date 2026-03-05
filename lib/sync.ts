import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPendingSales, markSaleSynced } from './offlineDb';
import { supabase } from './supabase';
import { getPosId } from './settings';

const SESSION_KEY = 'pos_employee_session';

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

    // Try to get employee id from background session
    let empId: string | null = null;
    try {
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        empId = session.employee_id;
      }
    } catch { }

    console.log('syncSalesQueue: posId', posId, 'pending', pending.length, 'empId', empId);
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
            p_employee_id: empId,
            p_customer_name: rec.data.customerName || null,
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
