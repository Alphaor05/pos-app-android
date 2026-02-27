import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'pos_bluetooth_printer';

export interface BluetoothDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
}

type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected';

interface BluetoothContextValue {
  connectedDevice: BluetoothDevice | null;
  status: ConnectionStatus;
  scannedDevices: BluetoothDevice[];
  startScan: () => void;
  stopScan: () => void;
  connect: (device: BluetoothDevice) => Promise<void>;
  disconnect: () => void;
  printReceipt: (items: { name: string; qty: number; price: number }[], total: number) => Promise<boolean>;
}

const BluetoothContext = createContext<BluetoothContextValue | null>(null);

const MOCK_DEVICES: BluetoothDevice[] = [
  { id: '1', name: 'Fiscal Printer FP-80', address: 'AA:BB:CC:DD:EE:01', rssi: -45 },
  { id: '2', name: 'DATECS FP-700', address: 'AA:BB:CC:DD:EE:02', rssi: -62 },
  { id: '3', name: 'EPSON TM-T88', address: 'AA:BB:CC:DD:EE:03', rssi: -70 },
  { id: '4', name: 'Star TSP143', address: 'AA:BB:CC:DD:EE:04', rssi: -78 },
];

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [scannedDevices, setScannedDevices] = useState<BluetoothDevice[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        const device = JSON.parse(stored) as BluetoothDevice;
        setConnectedDevice(device);
        setStatus('connected');
      }
    });
  }, []);

  const startScan = () => {
    setStatus('scanning');
    setScannedDevices([]);
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < MOCK_DEVICES.length) {
        setScannedDevices(prev => [...prev, MOCK_DEVICES[idx]]);
        idx++;
      } else {
        clearInterval(interval);
        setStatus(connectedDevice ? 'connected' : 'disconnected');
      }
    }, 700);
  };

  const stopScan = () => {
    setStatus(connectedDevice ? 'connected' : 'disconnected');
  };

  const connect = async (device: BluetoothDevice) => {
    setStatus('connecting');
    await new Promise(r => setTimeout(r, 1500));
    setConnectedDevice(device);
    setStatus('connected');
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  };

  const disconnect = async () => {
    setConnectedDevice(null);
    setStatus('disconnected');
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const printReceipt = async (items: { name: string; qty: number; price: number }[], total: number): Promise<boolean> => {
    if (status !== 'connected') return false;
    await new Promise(r => setTimeout(r, 800));
    return true;
  };

  const value = useMemo(() => ({
    connectedDevice,
    status,
    scannedDevices,
    startScan,
    stopScan,
    connect,
    disconnect,
    printReceipt,
  }), [connectedDevice, status, scannedDevices]);

  return <BluetoothContext.Provider value={value}>{children}</BluetoothContext.Provider>;
}

export function useBluetooth() {
  const ctx = useContext(BluetoothContext);
  if (!ctx) throw new Error('useBluetooth must be used within BluetoothProvider');
  return ctx;
}
