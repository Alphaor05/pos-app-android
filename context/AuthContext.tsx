import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CORRECT_PIN = '1234';
const PIN_KEY = 'pos_pin';

interface AuthContextValue {
  isAuthenticated: boolean;
  pin: string;
  login: (enteredPin: string) => Promise<boolean>;
  logout: () => void;
  changePin: (newPin: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState(CORRECT_PIN);

  useEffect(() => {
    AsyncStorage.getItem(PIN_KEY).then((stored) => {
      if (stored) setPin(stored);
    });
  }, []);

  const login = async (enteredPin: string): Promise<boolean> => {
    if (enteredPin === pin) {
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  const changePin = async (newPin: string) => {
    await AsyncStorage.setItem(PIN_KEY, newPin);
    setPin(newPin);
  };

  const value = useMemo(() => ({
    isAuthenticated,
    pin,
    login,
    logout,
    changePin,
  }), [isAuthenticated, pin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
