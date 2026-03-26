import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { getEmployeeByPin, queueAccessLog, updateAccessLogLogout } from '@/lib/offlineDb';
import { syncEmployees, syncAccessLogsQueue } from '@/lib/sync';

const SESSION_KEY = 'pos_employee_session';

export interface EmployeeSession {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  shop: string | null;
  access_log_id?: string | null;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  employee: EmployeeSession | null;
  shopId: string | null;
  login: (enteredPin: string) => Promise<boolean>;
  logout: () => void;
  updateShopId: (id: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [employee, setEmployee] = useState<EmployeeSession | null>(null);
  const [shopId, setStateShopId] = useState<string | null>(null);

  // Restore session from AsyncStorage on mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SESSION_KEY),
      AsyncStorage.getItem('pos_id')
    ]).then(([stored, storedShopId]) => {
      if (stored) {
        try {
          const session: EmployeeSession = JSON.parse(stored);
          setEmployee(session);
        } catch { }
      }
      if (storedShopId) {
        setStateShopId(storedShopId);
      }
      setIsLoading(false);
    });
  }, []);

  // For Web: attempt to logout if the browser tab is closed
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleBeforeUnload = () => {
        if (isAuthenticated && employee?.access_log_id) {
          // We use navigator.sendBeacon if available for reliable delivery on tab close
          // but calling logout() here is a best-effort fallback.
          logout();
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [isAuthenticated, employee]);

  const login = async (enteredPin: string): Promise<boolean> => {
    if (!supabase) {
      console.warn('[Auth] Supabase client not available');
      return false;
    }

    try {
      let data: any = null;
      let isOffline = false;

      if (supabase) {
        try {
          const { data: onlineData, error: onlineError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, role, shop, status')
            .eq('pin', enteredPin)
            .eq('status', 'active')
            .maybeSingle();
          
          if (!onlineError) {
            data = onlineData;
          } else {
            // Check if it's a network error
            if (onlineError.message?.includes('FetchError') || onlineError.message?.includes('network')) {
              isOffline = true;
            } else {
              console.error('[Auth] Supabase error:', onlineError.message);
            }
          }
        } catch (err) {
          isOffline = true;
        }
      } else {
        isOffline = true;
      }

      if (isOffline || !data) {
        // Try local database
        const localEmp = await getEmployeeByPin(enteredPin);
        if (localEmp) {
          data = localEmp;
          console.log('[Auth] Logged in via offline database');
        } else if (isOffline) {
          // If we are definitely offline and didn't find them locally, fail now.
          return false;
        }
      }

      if (!data) {
        // No matching active employee found (and we had connection to confirm)
        // or not found locally while offline.
        
        // Try to get employee_id for logging failure (best effort)
        const { data: empData } = supabase ? await supabase
          .from('employees')
          .select('employee_id')
          .eq('pin', enteredPin)
          .maybeSingle() : { data: null };

        const { logActivity } = await import('@/lib/activityLogger');
        await logActivity('login_failure', empData?.employee_id || null);

        return false;
      }

      const session: EmployeeSession = {
        employee_id: data.employee_id,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
        shop: data.shop,
      };

      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));

      // Create access log entry
      let accessLogId: string | null = null;
      try {
        if (!isOffline && supabase) {
          // Clean up any previously abandoned sessions for this employee
          await supabase
            .from('access_logs')
            .update({ logout_time: new Date().toISOString() })
            .eq('employee_id', data.employee_id)
            .is('logout_time', null);

          // Find shop_id first
          const { data: shopData } = await supabase
            .from('shops')
            .select('id')
            .eq('name', data.shop)
            .maybeSingle();

          // Determine which shop ID to use for this session's logging
          const effectiveShopId = shopId || shopData?.id;

          if (shopData && !shopId) {
            const { setPosId } = await import('@/lib/settings');
            await setPosId(shopData.id);
            setStateShopId(shopData.id);
          }

          if (effectiveShopId) {
            const { data: logData, error: logError } = await supabase
              .from('access_logs')
              .insert({
                employee_id: data.employee_id,
                shop_id: effectiveShopId,
                login_time: new Date().toISOString()
              })
              .select('id')
              .maybeSingle();

            if (!logError && logData) {
              accessLogId = logData.id;
              session.access_log_id = accessLogId;
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
            }
          }
          
          // Trigger a background sync of employees whenever we login successfully online
          syncEmployees();
          syncAccessLogsQueue();
        } else {
          // OFFLINE LOGIN: Queue access log locally
          const effectiveShopId = shopId; // Local device shop preference
          if (effectiveShopId) {
             const offlineLogId = await queueAccessLog({
               employee_id: data.employee_id,
               shop_id: effectiveShopId,
               login_time: new Date().toISOString()
             });
             session.access_log_id = `offline_${offlineLogId}`;
             await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
          }
        }
      } catch (logErr) {
        console.error('[Auth] Error creating access log:', logErr);
      }

      const { logActivity } = await import('@/lib/activityLogger');
      await logActivity('login_success', data.employee_id);

      setEmployee(session);
      setIsAuthenticated(true);
      return true;
    } catch (err) {
      console.error('[Auth] Unexpected error during login:', err);
      return false;
    }
  };

  const logout = async () => {
    if (employee?.access_log_id) {
      try {
        if (employee.access_log_id.startsWith('offline_')) {
          const offlineId = employee.access_log_id.replace('offline_', '');
          await updateAccessLogLogout(offlineId, new Date().toISOString());
          // Push sync best effort
          syncAccessLogsQueue();
        } else if (supabase) {
          await supabase
            .from('access_logs')
            .update({ logout_time: new Date().toISOString() })
            .eq('id', employee.access_log_id);
        }
      } catch (err) {
        console.error('[Auth] Error updating logout time:', err);
      }
    }
    await AsyncStorage.removeItem(SESSION_KEY);
    setEmployee(null);
    setIsAuthenticated(false);
  };

  const updateShopId = async (id: string | null) => {
    const { setPosId } = await import('@/lib/settings');
    await setPosId(id);
    setStateShopId(id);

    // If we have an active access log, update it in the backend too
    if (employee?.access_log_id && id && supabase) {
      try {
        await supabase
          .from('access_logs')
          .update({ shop_id: id })
          .eq('id', employee.access_log_id);
      } catch (err) {
        console.error('[Auth] Error updating access log shop:', err);
      }
    }
  };

  const value = useMemo(() => ({
    isAuthenticated,
    isLoading,
    employee,
    shopId,
    login,
    logout,
    updateShopId,
  }), [isAuthenticated, isLoading, employee, shopId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
