import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const SESSION_KEY = 'pos_employee_session';

export interface EmployeeSession {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  shop: string | null;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  employee: EmployeeSession | null;
  login: (enteredPin: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [employee, setEmployee] = useState<EmployeeSession | null>(null);

  // Restore session from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY).then((stored) => {
      if (stored) {
        try {
          const session: EmployeeSession = JSON.parse(stored);
          setEmployee(session);
          setIsAuthenticated(true);
        } catch {
          // corrupt storage – ignore
        }
      }
    });
  }, []);

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
      setEmployee(session);
      setIsAuthenticated(true);
      return true;
    } catch (err) {
      console.error('[Auth] Unexpected error during login:', err);
      return false;
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem(SESSION_KEY);
    setEmployee(null);
    setIsAuthenticated(false);
  };

  const value = useMemo(() => ({
    isAuthenticated,
    employee,
    login,
    logout,
  }), [isAuthenticated, employee]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
