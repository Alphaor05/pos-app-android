import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { centerText, dashedLine, formatRow2, formatRow3 } from '@/lib/escPosUtils';
import { printerService } from '@/lib/printerService';

const STORAGE_KEY = 'pos_bluetooth_printer';

export interface BluetoothDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
}

type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'bluetooth_off' | 'location_off';

export interface ReceiptData {
  orderId: string;
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  paymentMethod?: string;
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
  testPrint: () => Promise<boolean>;
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
        try {
          const device = JSON.parse(stored) as BluetoothDevice;
          setConnectedDevice(device);
          setStatus('connected');
        } catch (e) {
          AsyncStorage.removeItem(STORAGE_KEY);
        }
      }
    });
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    
    // For Android 12+ (API 31+)
    if (Platform.Version >= 31) {
      const { PermissionsAndroid } = require('react-native');
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        results['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        results['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        results['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const { PermissionsAndroid } = require('react-native');
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  };

  const startScan = async () => {
    const hasPerms = await checkPermissions();
    if (!hasPerms) {
      console.warn('Bluetooth permissions denied');
      return;
    }

    setStatus('scanning');
    setScannedDevices([]);
    
    if (Platform.OS === 'web') {
      setStatus('disconnected');
      return;
    }

    try {
      const { Printer } = require('react-native-esc-pos-printer');
      
      // Check if discovery is available
      if (!Printer.startDiscovery) {
        console.warn('Printer discovery not supported by this version/platform');
        setStatus('disconnected');
        return;
      }

      // Try with explicit type for better reliability on some units
      await Printer.startDiscovery({ type: 'bluetooth' }, (device: any) => {
        setScannedDevices(prev => {
          // Use deviceName or target as ID
          const deviceId = device.target || device.deviceName;
          if (!deviceId || prev.find(d => d.id === deviceId)) return prev;
          
          // New device discovered - VIBRATE
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }

          return [...prev, {
            id: deviceId,
            name: device.deviceName || 'Pos Printer',
            address: (device.target || '').replace('BT:', ''),
            rssi: device.rssi || 0
          }];
        });
      });

      // Stop scan after 12 seconds
      setTimeout(() => {
        Printer.stopDiscovery().catch(() => {});
        setStatus(prev => {
          if (prev === 'scanning') {
            return connectedDevice ? 'connected' : 'disconnected';
          }
          return prev;
        });
      }, 12000);

    } catch (error: any) {
      console.warn('Discovery failed', error);
      // provide more context in status if possible
      const msg = error?.message || '';
      if (msg.includes('Bluetooth') && msg.includes('off')) {
        setStatus('bluetooth_off');
      } else if (msg.includes('Location') || msg.includes('permission')) {
        setStatus('location_off');
      } else {
        setStatus('disconnected');
      }
    }
  };

  const stopScan = async () => {
    try {
      const { Printer } = require('react-native-esc-pos-printer');
      if (Printer.stopDiscovery) await Printer.stopDiscovery();
    } catch (e) {}
    setStatus(connectedDevice ? 'connected' : 'disconnected');
  };

  const connect = async (device: BluetoothDevice) => {
    setStatus('connecting');
    try {
      const hasPerms = await checkPermissions();
      if (!hasPerms) {
        Alert.alert('Permissions Required', 'Bluetooth and Location permissions are needed to connect to printers.');
        setStatus('disconnected');
        return;
      }

      // Ensure the stored address is just the MAC address
      const cleanAddress = device.address.replace(/^BT:|^TCP:|^USB:/, '');
      const cleanDevice = { ...device, address: cleanAddress };

      setConnectedDevice(cleanDevice);
      setStatus('connected');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDevice));
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

  const testPrint = async () => {
    if (!connectedDevice) {
      Alert.alert('No Printer', 'Please connect a printer first.');
      return false;
    }
    const testData: ReceiptData = {
      orderId: 'TEST-' + Math.random().toString(36).substring(7).toUpperCase(),
      items: [
        { name: 'Test Connection', quantity: 1, price: 0.00 }
      ],
      subtotal: 0.00,
      discount: 0,
      tax: 0,
      total: 0.00,
      paymentMethod: 'Diagnostics',
      createdAt: new Date().toISOString(),
      settings: {
        businessName: 'Printer Test',
        receiptSize: '58mm' // Default to 58mm to be safe during test
      }
    };
    return await printerService.printReceipt({ address: connectedDevice.address, name: connectedDevice.name }, testData);
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
    testPrint,
  }), [connectedDevice, status, scannedDevices]);

  return <BluetoothContext.Provider value={value}>{children}</BluetoothContext.Provider>;
}

export function useBluetooth() {
  const ctx = useContext(BluetoothContext);
  if (!ctx) throw new Error('useBluetooth must be used within BluetoothProvider');
  return ctx;
}
