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
  markAccessLogSynced,
  queueActivityLog,
  updateSaleSyncProgress,
  getEmployeeById,
  SaleRecord
} from './offlineDb';
import { supabase, handlePosSale } from './supabase';
import { getPosId } from './settings';

const SESSION_KEY = 'pos_employee_session';
const SYNC_TIMEOUT_MS = 30000; // 30 seconds max for a single sync attempt

// Use a timestamp to prevent stuck syncs (auto-release after TIMEOUT)
let syncingAt: number | null = null;
let activitySyncingAt: number | null = null;
let employeesSyncing = false;
let accessLogSyncing = false;

/**
 * Quick HEAD request to Supabase to check if we actually have a stable connection
 */
async function checkConnection(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(id);
    return response.ok || response.status === 401 || response.status === 405; // Supabase might return 401 or 405 on HEAD but it means it's reachable
  } catch (e) {
    return false;
  }
}

export function initSync() {
  let wasOffline = false;

  // trigger on transition from offline to online
  const listener = NetInfo.addEventListener((state: any) => {
    if (state.isConnected && wasOffline) {
      console.log('[Sync] Network recovered, waiting 3s for Starlink stabilization...');
      setTimeout(() => {
        triggerAllSyncs();
      }, 3000);
    }
    wasOffline = !state.isConnected;
  });

  // Run immediately
  triggerAllSyncs();

  // Periodic fallback: every 30 seconds to pick up stuck sales faster
  const interval = setInterval(() => {
    triggerAllSyncs();
  }, 30000); 

  return () => {
    listener();
    clearInterval(interval);
  };
}

async function triggerAllSyncs() {
  try {
    // Only proceed if connection actually works
    if (!(await checkConnection())) return;

    await syncSalesQueue();
    await syncActivityLogsQueue();
    await syncEmployees();
    await syncAccessLogsQueue();
  } catch (e) {
    console.warn('[Sync] triggerAllSyncs error:', e);
  }
}

export async function syncSalesQueue() {
  const now = Date.now();
  if (syncingAt && now - syncingAt < SYNC_TIMEOUT_MS) return;
  syncingAt = now;

  try {
    const pending = await getPendingSales();
    if (pending.length === 0) return;
    
    let posId: string | null = null;
    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        posId = await Promise.race([getPosId(), timeoutPromise]) as string;
    } catch (e) {
        console.warn('[Sync] Settings fetch timed out, will try again next cycle');
        posId = '046f42b7-a10f-4fb2-8af2-7f4bf2beb889'; // Keep fallback as per safety requirements
    }

    let empId: string | null = null;
    try {
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        empId = session.employee_id;
      }
    } catch { }

    for (const rec of pending) {
      await processSaleSync(rec, posId, empId);
    }
    
    await syncActivityLogsQueue();
    
  } catch (e) {
    console.warn('sync queue failed', e);
  } finally {
    syncingAt = null;
  }
}

/**
 * Dedicated function to sync a single sale, used for manual retries
 */
export async function syncSingleSale(saleId: string) {
  const pending = await getPendingSales();
  const rec = pending.find(p => p.id === saleId);
  if (!rec) return { success: true }; // Already synced or gone

  if (!(await checkConnection())) return { success: false, error: 'Still offline, will retry automatically' };

  try {
    const posId = await getPosId().catch(() => '046f42b7-a10f-4fb2-8af2-7f4bf2beb889');
    let empId: string | null = null;
    try {
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) empId = JSON.parse(stored).employee_id;
    } catch { }

    await processSaleSync(rec, posId, empId);
    
    // Check if it's now synced
    const refreshed = (await getPendingSales()).find(p => p.id === saleId);
    if (!refreshed) return { success: true };
    return { success: false, error: refreshed.last_error };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function processSaleSync(rec: SaleRecord, posId: string | null, empId: string | null) {
  try {
    if (!supabase) throw new Error('Supabase not configured');
    
    let saleShopId = rec.data.shopId || rec.data.shop_id || posId;

    if (!saleShopId && rec.data.employeeId) {
        const emp = await getEmployeeById(rec.data.employeeId);
        if (emp?.shop) saleShopId = emp.shop;
    }

    if (saleShopId) {
      await AsyncStorage.setItem('last_successful_shop_id', saleShopId);
      
      const currentAttempts = (rec as any).sync_attempts || 0;
      const nextAttempts = currentAttempts + 1;
      
      const { error } = await handlePosSale({
        p_shop_id: saleShopId,
        p_items: rec.data.items,
        p_order_id: rec.data.orderId || rec.data.order_id,
        p_total_amount: Math.round((rec.data.total || rec.data.amount || 0) * 100) / 100,
        p_payment_method: rec.data.paymentMethod || rec.data.payment_method || 'Cash',
        p_employee_id: rec.data.employeeId || rec.data.employee_id || empId,
        p_customer_name: rec.data.customerName || null,
        p_created_at: rec.data.createdAt || rec.data.created_at || rec.created_at,
      });

      if (error) {
        const isDuplicate = (error as any)?.code === '23505' || 
                          (error as any)?.message?.includes('duplicate key') ||
                          (error as any)?.message?.includes('unique constraint');

        if (isDuplicate) {
          await markSaleSynced(rec.id);
        } else {
          const errorMsg = (error as any)?.message || String(error);
          const isNetworkError = errorMsg.includes('Network request failed') || errorMsg.includes('TypeError');

          await updateSaleSyncProgress(rec.id, nextAttempts, errorMsg);
          
          // Only log genuine RPC failures to activity_logs
          if (!isNetworkError) {
            await queueActivityLog({
              employee_id: rec.data.employeeId || empId || 'system',
              action_type: 'sync_failure',
              amount: rec.data.total || 0,
              created_at: new Date().toISOString(),
              metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, attempts: nextAttempts })
            });
          }
        }
      } else {
        await markSaleSynced(rec.id);
        if (currentAttempts > 0) {
            await queueActivityLog({
                employee_id: rec.data.employeeId || empId || 'system',
                action_type: 'sale_complete', 
                amount: rec.data.total || 0,
                created_at: new Date().toISOString(),
                metadata: JSON.stringify({ order_id: rec.id, status: 'healed', previous_attempts: currentAttempts })
            });
        }
      }
    }
  } catch (err) {
    const errorMsg = String(err);
    const isNetworkError = errorMsg.includes('Network request failed') || errorMsg.includes('TypeError');
    
    await updateSaleSyncProgress(rec.id, ((rec as any).sync_attempts || 0) + 1, errorMsg);
    
    if (!isNetworkError) {
      await queueActivityLog({
          employee_id: rec.data.employeeId || empId || 'system',
          action_type: 'sync_failure',
          amount: rec.data.total || 0,
          created_at: new Date().toISOString(),
          metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, context: 'exception' })
      });
    }
  }
}

export async function syncActivityLogsQueue() {
  const now = Date.now();
  if (activitySyncingAt && now - activitySyncingAt < SYNC_TIMEOUT_MS) return;
  activitySyncingAt = now;

  try {
    const pending = await getPendingActivityLogs();
    if (pending.length === 0) return;

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
            metadata: rec.data.metadata,
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
      activitySyncingAt = null;
  }
}

export async function syncEmployees() {
  if (employeesSyncing) return;
  if (!supabase) return;
  
  employeesSyncing = true;
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, role, shop, pin, status')
      .eq('status', 'active');

    if (error) throw error;

    if (data && data.length > 0) {
      await clearEmployees();
      await bulkSaveEmployees(data);
    }
  } catch (err) {
    console.warn('[Sync] Failed to sync employees:', err);
  } finally {
    employeesSyncing = false;
  }
}

export async function syncAccessLogsQueue() {
  if (accessLogSyncing) return;
  if (!supabase) return;

  accessLogSyncing = true;
  try {
    const pending = await getPendingAccessLogs();
    if (pending.length === 0) return;

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

