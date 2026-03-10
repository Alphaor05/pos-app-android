import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

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
  login: (enteredPin: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [employee, setEmployee] = useState<EmployeeSession | null>(null);

  // Restore session from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY).then((stored) => {
      if (stored) {
        try {
          const session: EmployeeSession = JSON.parse(stored);
          setEmployee(session);
          // isAuthenticated stays false until login() is successfully called
        } catch {
          // corrupt storage – ignore
        }
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
      const { data, error } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, role, shop, status')
        .eq('pin', enteredPin)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        console.error('[Auth] Supabase error:', error.message);
        return false;
      }

      if (!data) {
        // No matching active employee found for this PIN
        // Try to get employee_id for logging even if status is not active or wrong PIN
        const { data: empData } = await supabase
          .from('employees')
          .select('employee_id')
          .eq('pin', enteredPin)
          .maybeSingle();

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

        if (shopData) {
          const { data: logData, error: logError } = await supabase
            .from('access_logs')
            .insert({
              employee_id: data.employee_id,
              shop_id: shopData.id,
              login_time: new Date().toISOString()
            })
            .select('id')
            .maybeSingle();

          if (!logError && logData) {
            accessLogId = logData.id;
            session.access_log_id = accessLogId;
            // Re-save session with log ID
            await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
          } else if (logError) {
            console.error('[Auth] Failed to create access log:', logError.message);
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
    if (employee?.access_log_id && supabase) {
      try {
        await supabase
          .from('access_logs')
          .update({ logout_time: new Date().toISOString() })
          .eq('id', employee.access_log_id);
      } catch (err) {
        console.error('[Auth] Error updating logout time:', err);
      }
    }
    await AsyncStorage.removeItem(SESSION_KEY);
    setEmployee(null);
    setIsAuthenticated(false);
  };

  const value = useMemo(() => ({
    isAuthenticated,
    isLoading,
    employee,
    login,
    logout,
  }), [isAuthenticated, isLoading, employee]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
