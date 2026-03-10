import { queueActivityLog } from './offlineDb';
import { syncActivityLogsQueue } from './sync';

export type ActionType = 'login_success' | 'login_failure' | 'transaction_cancelled' | 'transaction_void' | 'sale_complete';

/**
 * Logs an activity. 
 * This version queues the log locally first to support offline actions,
 * then attempts an immediate sync.
 */
export async function logActivity(
    actionType: ActionType,
    employeeId: string | null,
    metadata: { amount?: number; discount?: number } = {}
) {
    try {
        // 1. Always queue locally first
        await queueActivityLog({
            employee_id: employeeId,
            action_type: actionType,
            amount: metadata.amount,
            discount: metadata.discount,
            created_at: new Date().toISOString()
        });

        // 2. Effort to sync immediately
        syncActivityLogsQueue();

        console.log(`[ActivityLogger] Queued ${actionType} locally`);
    } catch (err) {
        console.error(`[ActivityLogger] Failed to queue ${actionType}:`, err);
    }
}
