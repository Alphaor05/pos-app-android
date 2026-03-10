import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { centerText, dashedLine, formatRow2, formatRow3 } from '@/lib/escPosUtils';
import { printerService } from '@/lib/printerService';

const STORAGE_KEY = 'pos_bluetooth_printer';

export interface BluetoothDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
}

type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected';

export interface ReceiptData {
  orderId: string;
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  settings?: {
    businessName?: string;
    address?: string;
    contactTel?: string;
    footerMessage?: string;
    receiptSize?: string;
  };
}

interface BluetoothContextValue {
  connectedDevice: BluetoothDevice | null;
  status: ConnectionStatus;
  scannedDevices: BluetoothDevice[];
  startScan: () => void;
  stopScan: () => void;
  connect: (device: BluetoothDevice) => Promise<void>;
  disconnect: () => void;
  printReceipt: (data: ReceiptData) => Promise<boolean>;
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
    try {
      // In a real environment, you would instantiate and connect here:
      // const printer = new Printer({ target: `BT:${device.address}`, deviceName: device.name });
      // await printer.connect();

      await new Promise(r => setTimeout(r, 1500));
      setConnectedDevice(device);
      setStatus('connected');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(device));
    } catch (error) {
      console.warn('Connection failed', error);
      setStatus('disconnected');
    }
  };

  const disconnect = async () => {
    setConnectedDevice(null);
    setStatus('disconnected');
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const printReceipt = async (data: ReceiptData): Promise<boolean> => {
    if (status !== 'connected' || !connectedDevice) return false;

    return printerService.printReceipt({
      address: connectedDevice.address,
      name: connectedDevice.name
    }, data);
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
