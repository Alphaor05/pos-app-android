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
  getEmployeeById
} from './offlineDb';
import { supabase, handlePosSale } from './supabase';
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
    
    // Add a timeout to settings fetch to prevent hanging the whole sync
    let posId: string | null = null;
    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        posId = await Promise.race([getPosId(), timeoutPromise]) as string;
    } catch (e) {
        console.warn('[Sync] Settings fetch took too long or failed, using context fallback');
        // Nuclear fallback: If we know this is MT CBD, we use its ID directly
        posId = '046f42b7-a10f-4fb2-8af2-7f4bf2beb889'; 
    }

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
        let saleShopId = rec.data.shopId || rec.data.shop_id || posId;

        // NEW: Fallback to employee's assigned shop if still missing
        if (!saleShopId && rec.data.employeeId) {
            const emp = await getEmployeeById(rec.data.employeeId);
            if (emp?.shop) {
                saleShopId = emp.shop;
                console.log(`[Sync] Fallback shop name for sale ${rec.id}: ${saleShopId}`);
            }

            // Still missing? Try most recent access log (login)
            if (!saleShopId || saleShopId.length < 10) { // Check if it's a name vs UUID
                const accessLogs = await getPendingAccessLogs();
                if (accessLogs.length > 0) {
                    saleShopId = accessLogs[0].shop_id;
                    console.log(`[Sync] Fallback shop ID from access logs for sale ${rec.id}: ${saleShopId}`);
                }
            }
        }

        if (saleShopId) {
          // NEW: Store the last successful shop ID for recovery purposes
          await AsyncStorage.setItem('last_successful_shop_id', saleShopId);
          
          // Track attempt
          const currentAttempts = (rec as any).sync_attempts || 0;
          const nextAttempts = currentAttempts + 1;
          
          // call POS sale RPC
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
            console.error('syncSalesQueue: handle_pos_sale RPC failed', rec.id, error);
            
            // SELF-HEALING: Update local DB with error info for admins
            const errorMsg = (error as any)?.message || String(error);
            await updateSaleSyncProgress(rec.id, nextAttempts, errorMsg);
            
            // Remote Logging
            await queueActivityLog({
              employee_id: rec.data.employeeId || empId || 'system',
              action_type: 'sync_failure',
              amount: rec.data.total || 0,
              created_at: new Date().toISOString(),
              metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, attempts: nextAttempts })
            });
          } else {
            // SUCCESS
            await markSaleSynced(rec.id);
            
            // If it succeeded after failing before, log it as "healed"
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
        } else {
          // FINAL FALLBACK: Try the last successful shop ID the device remembers
          const rememberedShopId = await AsyncStorage.getItem('last_successful_shop_id');
          if (rememberedShopId) {
             console.log(`[Sync] Using memory fallback for shopId: ${rememberedShopId}`);
             // We'll set it here but let the NEXT loop iteration pick it up or we can recursively call?
             // Better to just update the record in memory for this loop
             saleShopId = rememberedShopId;
             // ... proceed with sync using rememberedShopId ...
             
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
             
             if (!error) {
                 await markSaleSynced(rec.id);
             } else {
                 console.error('[Sync] Memory fallback sync failed', error);
                 await updateSaleSyncProgress(rec.id, ((rec as any).sync_attempts || 0) + 1, (error as any).message);
             }
          } else {
            const errorMsg = 'Missing Shop ID and no fallback found';
            console.warn(`syncSalesQueue: ${errorMsg} for sale ${rec.id}`);
            
            await updateSaleSyncProgress(rec.id, ((rec as any).sync_attempts || 0) + 1, errorMsg);
            await queueActivityLog({
                employee_id: rec.data.employeeId || empId || 'system',
                action_type: 'sync_failure',
                amount: rec.data.total || 0,
                created_at: new Date().toISOString(),
                metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, context: 'missing_shop_id' })
            });
          }
        }
      } catch (err) {
        const errorMsg = String(err);
        console.warn('Failed to sync sale', rec.id, err);
        await updateSaleSyncProgress(rec.id, ((rec as any).sync_attempts || 0) + 1, errorMsg);
        
        // NEW: Remote logging for exceptions (Network, etc.)
        await queueActivityLog({
            employee_id: rec.data.employeeId || empId || 'system',
            action_type: 'sync_failure',
            amount: rec.data.total || 0,
            created_at: new Date().toISOString(),
            metadata: JSON.stringify({ order_id: rec.id, error: errorMsg, context: 'exception' })
        });
      }
    }
    
    // NEW: Always force a sync of activity logs after attempting a sales sync
    // This ensures that any sync_failures are reported to the Admin Dashboard immediately.
    await syncActivityLogsQueue();
    
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
