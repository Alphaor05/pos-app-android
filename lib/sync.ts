import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPendingSales,
  markSaleSynced,
  getPendingActivityLogs,
  markActivityLogSynced,
  bulkSaveEmployees,
  clearEmployees,
  getPendingAccessLogs,
  markAccessLogSynced,
  queueActivityLog,
  updateSaleSyncProgress,
  getEmployeeById,
  SaleRecord,
  getPendingMessages,
  markMessageSynced,
  updateMessageSyncProgress,
  CashierMessageRecord
} from './offlineDb';
import { supabase, handlePosSale } from './supabase';
import { getPosId } from './settings';

const SESSION_KEY = 'pos_employee_session';

// How many genuine (non-network) failures before a sale is parked as BLOCKED.
// BLOCKED sales stop the 30s auto-retry loop and are only re-attempted on a
// slow cadence or manually, so a permanent server-side error can't spam the
// network or the cashier forever.
export const MAX_ATTEMPTS = 20;

// Max time we wait for a single RPC/insert before moving on. Prevents a hung
// connection from deadlocking the whole queue.
const SYNC_RPC_TIMEOUT_MS = 15000;

// How often BLOCKED sales are automatically re-attempted (self-heal when the
// root cause is fixed server-side).
const BLOCKED_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Re-entrancy guards (booleans + try/finally, never timestamp hacks so a
// hung promise can't leave the queue permanently locked).
let salesSyncInProgress = false;
let activitySyncing = false;
let employeesSyncing = false;
let accessLogSyncing = false;
let messagesSyncing = false;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Sync timeout')), ms);
    promise.then(
      (val) => { clearTimeout(id); resolve(val); },
      (err) => { clearTimeout(id); reject(err); }
    );
  });
}

function isNetworkError(msg: string): boolean {
  return msg.includes('Network request failed') || msg.includes('TypeError') || msg.includes('Sync timeout');
}

/**
 * Verifies there is a working network path to Supabase before any queue
 * touches the network.
 *
 * ANY completed HTTP response — regardless of status code — proves DNS,
 * TCP, TLS and the Supabase edge are all up, which is the only thing this
 * gate cares about. Deciding reachability by status code is how this gate
 * once went permanently false: the project root answers 404, so every
 * automatic sync silently no-op'd while ungated call sites masked it.
 * Never filter on status here again.
 *
 * Failures (offline, DNS dead, 5s timeout) return false and cost nothing
 * but the probe itself.
 */
async function checkConnection(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) return false;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  try {
    // /rest/v1/ is a permanent API endpoint; the root is not (it 404s).
    await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

// Auto-sync cadence. Every tick is gated behind checkConnection(), so an
// offline device costs nothing but a local probe.
const SYNC_INTERVAL_MS = 30 * 1000;

// Grace period after a connectivity transition — routers (especially
// Starlink) often report "up" a few seconds before traffic actually flows.
const NETWORK_SETTLE_MS = 3000;

/**
 * Single mount point for all automatic syncing (called once from the root
 * layout). Layers, in order of responsiveness:
 *
 *   1. NetInfo transition to online      → sync after a short settle delay
 *   2. App returning to foreground       → sync immediately (Android pauses
 *                                          JS timers while backgrounded)
 *   3. 30s periodic fallback             → catches anything the events missed
 *
 * Every path funnels into triggerAllSyncs(), which checks actual internet
 * reachability first and no-ops when offline.
 */
export function initSync() {
  // Tracks interface + internet reachability together: Wi-Fi can stay
  // connected while the WAN is down, so isConnected alone misses dropouts.
  let isOnline = true;

  const handleConnectionEstablished = () => {
    console.log('[Sync] Connection established, waiting for network stabilization...');
    setTimeout(() => {
      triggerAllSyncs();
    }, NETWORK_SETTLE_MS);
  };

  const unsubscribeNetInfo = NetInfo.addEventListener((state: any) => {
    const online =
      !!state.isConnected && state.isInternetReachable !== false;
    if (online && !isOnline) {
      handleConnectionEstablished();
    }
    isOnline = online;
  });

  // Attempt immediately at launch.
  triggerAllSyncs();

  const interval = setInterval(() => {
    triggerAllSyncs();
  }, SYNC_INTERVAL_MS);

  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      triggerAllSyncs();
    }
  });

  return () => {
    unsubscribeNetInfo();
    clearInterval(interval);
    appStateSub.remove();
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
    // Messages run last so they can never delay sales or access logs.
    await syncMessagesQueue();
  } catch (e) {
    console.warn('[Sync] triggerAllSyncs error:', e);
  }
}

export async function syncSalesQueue() {
  if (salesSyncInProgress) return;
  salesSyncInProgress = true;

  try {
    const pending = await getPendingSales();
    if (pending.length === 0) return;

    let posId: string | null = null;
    try {
      posId = await withTimeout(getPosId(), 3000);
    } catch (e) {
      console.warn('[Sync] Settings fetch timed out, will try again next cycle');
    }

    let empId: string | null = null;
    try {
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        empId = session.employee_id;
      }
    } catch { }

    const now = Date.now();
    for (const rec of pending) {
      const attempts = rec.sync_attempts || 0;

      // BLOCKED sales are only re-attempted on a slow cadence so a permanent
      // server-side error can't spam the network every 30s. Manual retries
      // (syncSingleSale / retryBlockedSales) always go through regardless.
      if (attempts >= MAX_ATTEMPTS) {
        const last = rec.last_attempt_at ? new Date(rec.last_attempt_at).getTime() : 0;
        if (now - last < BLOCKED_RETRY_INTERVAL_MS) continue;
      }

      // processSaleSync never throws and has an internal timeout, so one bad
      // or slow record can never block the rest of the queue.
      await processSaleSync(rec, posId, empId);
    }

    await syncActivityLogsQueue();

  } catch (e) {
    console.warn('sync queue failed', e);
  } finally {
    salesSyncInProgress = false;
  }
}

/**
 * Dedicated function to sync a single sale, used for manual retries.
 * Always attempts regardless of BLOCKED state.
 */
export async function syncSingleSale(saleId: string) {
  const pending = await getPendingSales();
  const rec = pending.find(p => p.id === saleId);
  if (!rec) return { success: true }; // Already synced or gone

  if (!(await checkConnection())) return { success: false, error: 'Still offline, will retry automatically' };

  try {
    let posId: string | null = null;
    try {
      posId = await withTimeout(getPosId(), 3000);
    } catch { }
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

/**
 * Bulk re-attempt every BLOCKED sale (cashiers + admins). Useful after the
 * underlying server-side cause has been fixed.
 */
export async function retryBlockedSales(): Promise<{ attempted: number; synced: number; failed: number }> {
  const pending = await getPendingSales();
  const blocked = pending.filter(p => (p.sync_attempts || 0) >= MAX_ATTEMPTS);

  let synced = 0;
  let failed = 0;
  for (const rec of blocked) {
    const result = await syncSingleSale(rec.id);
    if (result.success) synced++;
    else failed++;
  }
  return { attempted: blocked.length, synced, failed };
}

async function processSaleSync(rec: SaleRecord, posId: string | null, empId: string | null) {
  const attempts = rec.sync_attempts || 0;

  // Transient errors (offline/timeout) don't advance attempts toward BLOCKED,
  // so a long offline stretch can never permanently park a healthy sale.
  const recordFailure = async (errorMsg: string, transient: boolean) => {
    const nextAttempts = transient ? attempts : attempts + 1;
    await updateSaleSyncProgress(rec.id, nextAttempts, errorMsg);
    return nextAttempts;
  };

  try {
    if (!supabase) throw new Error('Supabase not configured');

    let saleShopId = rec.data.shopId || rec.data.shop_id || posId;

    if (!saleShopId && rec.data.employeeId) {
      const emp = await getEmployeeById(rec.data.employeeId);
      if (emp?.shop) saleShopId = emp.shop;
    }

    if (!saleShopId) {
      // NEVER silently skip: a sale with no resolvable shop must surface as a
      // visible failure instead of being retried forever doing nothing.
      const next = await recordFailure('No shop assigned to this sale — assign a shop in Settings to sync it.', false);
      DeviceEventEmitter.emit('sync_failure', {
        saleId: rec.id,
        error: 'No shop assigned',
        orderId: rec.data.orderId || rec.id,
        items: rec.data.items
      });
      await queueActivityLog({
        employee_id: rec.data.employeeId || empId || 'system',
        action_type: 'sync_failure',
        amount: rec.data.total || 0,
        created_at: new Date().toISOString(),
        metadata: JSON.stringify({ order_id: rec.id, error: 'No shop assigned', attempts: next })
      });
      return;
    }

    await AsyncStorage.setItem('last_successful_shop_id', saleShopId);

    let result: { data: any; error: any };
    try {
      result = await withTimeout(
        handlePosSale({
          p_shop_id: saleShopId,
          p_items: Array.isArray(rec.data.items)
            ? rec.data.items.map((it: any) => ({
                ...it,
                price: Math.round((Number(it.price) || 0) * 100) / 100,
              }))
            : rec.data.items,
          p_order_id: rec.data.orderId || rec.data.order_id,
          p_total_amount: Math.round((rec.data.total || rec.data.amount || 0) * 100) / 100,
          p_payment_method: rec.data.paymentMethod || rec.data.payment_method || 'Cash',
          p_employee_id: rec.data.employeeId || rec.data.employee_id || empId,
          p_customer_name: rec.data.customerName || null,
          p_created_at: rec.data.createdAt || rec.data.created_at || rec.created_at,
        }),
        SYNC_RPC_TIMEOUT_MS
      );
    } catch (err) {
      // RPC threw or timed out — treat as transient, don't advance attempts.
      const errorMsg = String(err);
      await recordFailure(errorMsg, isNetworkError(errorMsg));
      return;
    }

    const { error } = result;

    if (error) {
      const isDuplicate = (error as any)?.code === '23505' ||
        (error as any)?.message?.includes('duplicate key') ||
        (error as any)?.message?.includes('unique constraint');

      if (isDuplicate) {
        await markSaleSynced(rec.id);
        DeviceEventEmitter.emit('sync_success', { saleId: rec.id });
        return;
      }

      const errorMsg = (error as any)?.message || String(error);
      const transient = isNetworkError(errorMsg);
      const next = await recordFailure(errorMsg, transient);

      if (!transient) {
        // Emit UI notifications only on state transitions: first failure and
        // the moment a sale becomes BLOCKED. Avoids spam on every cycle.
        if (next === 1) {
          DeviceEventEmitter.emit('sync_failure', {
            saleId: rec.id,
            error: errorMsg,
            orderId: rec.data.orderId || rec.id,
            items: rec.data.items,
            attempts: next,
          });
        } else if (next === MAX_ATTEMPTS) {
          DeviceEventEmitter.emit('sale_blocked', {
            saleId: rec.id,
            error: errorMsg,
            orderId: rec.data.orderId || rec.id,
            items: rec.data.items,
            attempts: next,
          });
        }

        await queueActivityLog({
          employee_id: rec.data.employeeId || empId || 'system',
          action_type: 'sync_failure',
          amount: rec.data.total || 0,
          created_at: new Date().toISOString(),
          metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, attempts: next })
        });
      }
    } else {
      await markSaleSynced(rec.id);
      DeviceEventEmitter.emit('sync_success', { saleId: rec.id });
      if (attempts > 0) {
        await queueActivityLog({
          employee_id: rec.data.employeeId || empId || 'system',
          action_type: 'sale_complete',
          amount: rec.data.total || 0,
          created_at: new Date().toISOString(),
          metadata: JSON.stringify({ order_id: rec.id, status: 'healed', previous_attempts: attempts })
        });
      }
    }
  } catch (err) {
    const errorMsg = String(err);
    const transient = isNetworkError(errorMsg);
    const next = await recordFailure(errorMsg, transient);

    if (!transient) {
      await queueActivityLog({
        employee_id: rec.data.employeeId || empId || 'system',
        action_type: 'sync_failure',
        amount: rec.data.total || 0,
        created_at: new Date().toISOString(),
        metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, context: 'exception', attempts: next })
      });
    }
  }
}

export async function syncActivityLogsQueue() {
  if (activitySyncing) return;
  activitySyncing = true;

  try {
    const pending = await getPendingActivityLogs();
    if (pending.length === 0) return;

    for (const rec of pending) {
      try {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await withTimeout(
          supabase
            .from('activity_logs')
            .insert({
              employee_id: rec.data.employee_id,
              action_type: rec.data.action_type,
              amount: rec.data.amount,
              discount: rec.data.discount,
              metadata: rec.data.metadata,
              created_at: rec.data.created_at || rec.created_at
            }),
          SYNC_RPC_TIMEOUT_MS
        );

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

export async function syncEmployees() {
  if (employeesSyncing) return;
  if (!supabase) return;

  employeesSyncing = true;
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('employees')
        .select('employee_id, first_name, last_name, role, shop, pin, status')
        .eq('status', 'active'),
      SYNC_RPC_TIMEOUT_MS
    );

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
        const { error } = await withTimeout(
          supabase
            .from('access_logs')
            .insert({
              employee_id: rec.employee_id,
              shop_id: rec.shop_id,
              login_time: rec.login_time,
              logout_time: rec.logout_time
            }),
          SYNC_RPC_TIMEOUT_MS
        );

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

export async function syncMessagesQueue() {
  if (messagesSyncing) return;
  messagesSyncing = true;

  try {
    if (!supabase) return;
    const pending = await getPendingMessages();
    if (pending.length === 0) return;

    let posId: string | null = null;
    try {
      posId = await withTimeout(getPosId(), 3000);
    } catch { }

    const now = Date.now();
    for (const rec of pending) {
      const attempts = rec.sync_attempts || 0;

      // Parked messages re-attempt on the slow cadence only, mirroring the
      // sales queue so a permanent server-side error can't spam the network.
      if (attempts >= MAX_ATTEMPTS) {
        const last = rec.last_attempt_at ? new Date(rec.last_attempt_at).getTime() : 0;
        if (now - last < BLOCKED_RETRY_INTERVAL_MS) continue;
      }

      await processMessageSync(rec, posId);
    }
  } catch (e) {
    console.warn('[Sync] messages queue failed:', e);
  } finally {
    messagesSyncing = false;
  }
}

async function processMessageSync(rec: CashierMessageRecord, posId: string | null) {
  const attempts = rec.sync_attempts || 0;

  // Transient errors don't advance attempts toward BLOCKED.
  const recordFailure = async (errorMsg: string, transient: boolean) => {
    const nextAttempts = transient ? attempts : attempts + 1;
    await updateMessageSyncProgress(rec.id, nextAttempts, errorMsg);
    return nextAttempts;
  };

  try {
    if (!supabase) throw new Error('Supabase not configured');

    // Shop attribution is advisory (AsyncStorage pos_id), same chain as the
    // sales queue: payload first, then device setting. Never silently skip —
    // an unattributable message must surface as a visible failure.
    const shopId = rec.data.shop_id || posId;
    if (!shopId) {
      await recordFailure('No shop assigned — set a shop in Settings to send messages.', false);
      DeviceEventEmitter.emit('message_sync_failure', { messageId: rec.id, error: 'No shop assigned' });
      return;
    }

    const { error } = await withTimeout(
      supabase
        .from('cashier_messages')
        .insert({
          client_msg_id: rec.id,
          shop_id: shopId,
          message_text: rec.data.message_text,
          category: rec.data.category || 'Other',
          employee_id: rec.data.employee_id || null,
          employee_name: rec.data.employee_name || null,
          created_at: rec.data.created_at || rec.created_at
        }),
      SYNC_RPC_TIMEOUT_MS
    );

    if (error) {
      // Already-delivered duplicate (crash between insert and markSynced) is
      // success — same treatment as duplicate receipts in processSaleSync.
      const isDuplicate = (error as any)?.code === '23505' ||
        (error as any)?.message?.includes('duplicate key') ||
        (error as any)?.message?.includes('unique constraint');
      if (isDuplicate) {
        await markMessageSynced(rec.id);
        DeviceEventEmitter.emit('message_sync_success', { messageId: rec.id });
        return;
      }

      const errorMsg = (error as any)?.message || String(error);
      await recordFailure(errorMsg, isNetworkError(errorMsg));
      return;
    }

    await markMessageSynced(rec.id);
    DeviceEventEmitter.emit('message_sync_success', { messageId: rec.id });
  } catch (err) {
    const errorMsg = String(err);
    await recordFailure(errorMsg, isNetworkError(errorMsg));
  }
}
