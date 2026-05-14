import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  getPendingSales, 
  markSaleSynced, 
  getPendingActivityLogs, 
  markActivityLogSynced,
  saveEmployee,
  bulkSaveEmployees,
  clearEmployees,
  getPendingAccessLogs,
  markAccessLogSynced
} from './offlineDb';
import { supabase } from './supabase';
import { getPosId } from './settings';

const SESSION_KEY = 'pos_employee_session';

let syncing = false;

export function initSync() {
  // trigger on mount and whenever we regain connectivity
  NetInfo.addEventListener((state: any) => {
    if (state.isConnected) {
      syncSalesQueue();
      syncActivityLogsQueue();
      syncEmployees();
      syncAccessLogsQueue();
    }
  });
  syncSalesQueue();
  syncActivityLogsQueue();
  syncEmployees();
  syncAccessLogsQueue();
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
        
        // Use the shopId captured at the time of sale if available, 
        // fallback to current posId from settings.
        const saleShopId = rec.data.shopId || rec.data.shop_id || posId;

        if (saleShopId) {
          // call POS sale RPC
          const { handlePosSale, insertTransactionReceipt } = await import('@/lib/supabase');
          const { error } = await handlePosSale({
            p_shop_id: saleShopId,
            p_items: rec.data.items,
            p_order_id: rec.data.orderId || rec.data.order_id,
            p_total_amount: rec.data.total || rec.data.amount || 0,
            p_payment_method: rec.data.paymentMethod || rec.data.payment_method || 'Cash',
            p_employee_id: rec.data.employeeId || rec.data.employee_id || empId,
            p_customer_name: rec.data.customerName || null,
            p_created_at: rec.data.createdAt || rec.data.created_at || rec.created_at,
          });

          if (error) {
            console.error('syncSalesQueue: handle_pos_sale RPC failed, skipping fallback', rec.id, error);
            // No fallback — the RPC handles all inserts atomically.
          } else {
            await markSaleSynced(rec.id);
          }
        } else {
          console.warn('syncSalesQueue: No shop_id found for sale', rec.id, '. Keeping in queue.');
          // We do NOT mark as synced here so it stays in the queue until a shop_id is available.
        }
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

let activitySyncing = false;

export async function syncActivityLogsQueue() {
  if (activitySyncing) return;
  activitySyncing = true;
  try {
    const pending = await getPendingActivityLogs();
    if (pending.length === 0) return;

    console.log('syncActivityLogsQueue: pending', pending.length);
    for (const rec of pending) {
      try {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
          .from('activity_logs')
          .insert({
            employee_id: rec.data.employee_id,
            action_type: rec.data.action_type,
            amount: rec.data.amount,
            discount: rec.data.discount,
            created_at: rec.data.created_at || rec.created_at
          });

        if (error) throw error;
        await markActivityLogSynced(rec.id);
      } catch (err) {
        console.warn('Failed to sync activity log', rec.id, err);
      }
    }
  } catch (e) {
    console.warn('sync activity queue failed', e);
  } finally {
      activitySyncing = false;
  }
}

let employeesSyncing = false;

export async function syncEmployees() {
  if (employeesSyncing) return;
  if (!supabase) return;
  
  employeesSyncing = true;
  try {
    console.log('[Sync] Syncing employees...');
    const { data, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, role, shop, pin, status')
      .eq('status', 'active');

    if (error) throw error;

    if (data && data.length > 0) {
      // Use bulk save for better performance
      await clearEmployees();
      await bulkSaveEmployees(data);
      console.log(`[Sync] Successfully synced ${data.length} employees.`);
    }
  } catch (err) {
    console.warn('[Sync] Failed to sync employees:', err);
  } finally {
    employeesSyncing = false;
  }
}

let accessLogSyncing = false;

export async function syncAccessLogsQueue() {
  if (accessLogSyncing) return;
  if (!supabase) return;

  accessLogSyncing = true;
  try {
    const pending = await getPendingAccessLogs();
    if (pending.length === 0) return;

    console.log(`[Sync] Syncing ${pending.length} access logs...`);
    for (const rec of pending) {
      try {
        const { error } = await supabase
          .from('access_logs')
          .insert({
            employee_id: rec.employee_id,
            shop_id: rec.shop_id,
            login_time: rec.login_time,
            logout_time: rec.logout_time
          });

        if (error) throw error;
        await markAccessLogSynced(rec.id);
      } catch (err) {
        console.warn('Failed to sync access log', rec.id, err);
      }
    }
  } catch (err) {
    console.warn('[Sync] Access log sync failed:', err);
  } finally {
    accessLogSyncing = false;
  }
}
