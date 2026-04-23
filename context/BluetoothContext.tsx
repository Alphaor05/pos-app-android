import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Platform, Alert, AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { printerService } from '@/lib/printerService';
import { useAuth } from '@/context/AuthContext';

const STORAGE_KEY = 'pos_bluetooth_printer';

export interface BluetoothDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
}

type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'failed' | 'bluetooth_off';

export interface ReceiptData {
  orderId: string;
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  tax?: number;
  total: number;
  createdAt: string;
  paymentMethod?: string;
  employeeName?: string;
  shopId?: string | null;
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
  pairedDevices: BluetoothDevice[];
  startScan: () => void;
  stopScan: () => void;
  connect: (device: BluetoothDevice) => Promise<void>;
  disconnect: () => void;
  printReceipt: (data: ReceiptData) => Promise<boolean>;
  testPrint: () => Promise<boolean>;
  refreshPairedDevices: () => Promise<void>;
  enableBluetooth: () => Promise<boolean>;
  openSettings: () => Promise<boolean>;
  isPrinting: boolean;
}

const BluetoothContext = createContext<BluetoothContextValue | null>(null);

const MOCK_DEVICES: BluetoothDevice[] = [
  { id: '1', name: 'Fiscal Printer FP-80', address: 'AA:BB:CC:DD:EE:01', rssi: -45 },
  { id: '2', name: 'DATECS FP-700', address: 'AA:BB:CC:DD:EE:02', rssi: -62 },
  { id: '3', name: 'EPSON TM-T88', address: 'AA:BB:CC:DD:EE:03', rssi: -70 },
  { id: '4', name: 'Star TSP143', address: 'AA:BB:CC:DD:EE:04', rssi: -78 },
];

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const { shopId } = useAuth();
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
  const [scannedDevices, setScannedDevices] = useState<BluetoothDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    const initPrinter = async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const device = JSON.parse(stored) as BluetoothDevice;
          setConnectedDevice(device);
          setStatus('connecting');

          // Verify if the stored device is actually reachable
          const { NativeModules } = require('react-native');
          if (NativeModules.PrinterModule?.verifyHardware) {
            try {
              const result = await NativeModules.PrinterModule.verifyHardware(device.address);
              
              // Handle both old string format and new object format
              const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
              
              if (status_code === 'SUCCESS') {
                setStatus('connected');
              } else if (status_code === 'NO_BLUETOOTH') {
                setStatus('bluetooth_off');
              } else {
                setStatus('failed');
              }
            } catch (verifyError) {
              console.warn('Initialization verification error:', verifyError);
              setStatus('failed');
            }
          } else {
            // Fallback if native module isn't ready
            setStatus('connected');
          }
        } catch (e) {
          console.warn('Failed to restore printer', e);
          AsyncStorage.removeItem(STORAGE_KEY);
          setStatus('disconnected');
        }
      }
    };

    initPrinter();
    refreshPairedDevices();

    // Refresh list when app returns to foreground (after user pairs in settings)
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        console.log('[BT] App returned to foreground, refreshing paired list...');
        refreshPairedDevices();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    // Listen for discovered devices from the native scan
    const sub = DeviceEventEmitter.addListener('onDeviceFound', (device) => {
      setScannedDevices(prev => {
        if (prev.find(d => d.address === device.address)) return prev;
        const newDevice = {
          id: device.address,
          name: device.name || 'Nearby Printer',
          address: device.address,
          rssi: 0
        };
        return [...prev, newDevice];
      });
    });

    return () => {
      sub.remove();
    };
  }, []);

  const refreshPairedDevices = async () => {
    try {
      // UNIVERSAL PERMISSION REQUEST (The "Nuclear Option")
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const permsToRequest = [];

        // 1. Android 12+ Bluetooth permissions
        if (Platform.Version >= 31) {
          permsToRequest.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
          permsToRequest.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
        }

        // 2. Location permissions (Required for Bluetooth on many tablets/versions)
        permsToRequest.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);

        const results = await PermissionsAndroid.requestMultiple(permsToRequest);
        
        // Log results for debugging
        console.log('[BT] Permission results:', results);

        const allGranted = Object.values(results).every(
          res => res === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          console.log('[BT] Some permissions denied. Continuing anyway to try hardware access...');
        }
      }
      
      const paired = await printerService.getPairedDevices();
      const formattedPaired = paired.map((d: any) => ({
        id: d.id || d.address,
        name: d.name || 'Bluetooth Printer',
        address: d.address,
        rssi: 0
      }));
      setPairedDevices(formattedPaired);
      console.log('[BT] Found paired devices:', formattedPaired.length);
    } catch (error) {
      console.warn('Failed to refresh paired devices', error);
    }
  };

  const checkPermissions = async () => {
    if (Platform.OS !== 'android') return true;

    // For Android 12+ (API 31+) - only BLUETOOTH_CONNECT is needed for paired devices
    if (Platform.Version >= 31) {
      const { PermissionsAndroid } = require('react-native');
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }

    // Android < 12: No runtime permissions needed for bonded devices
    return true;
  };

  const enableBluetooth = async () => {
    if (Platform.OS === 'android') {
      return await printerService.enableBluetooth();
    }
    return false;
  };

  const openSettings = async () => {
    if (Platform.OS === 'android') {
      return await printerService.openSettings();
    }
    return false;
  };

  // Deprecated scanning logic - now just refreshes paired list
  const startScan = async () => {
    const hasPerms = await checkPermissions();
    if (!hasPerms) {
      Alert.alert('Permission Denied', 'Bluetooth permission is required to list printers.');
      return;
    }
    
    setIsScanning(true);
    setScannedDevices([]); // Clear previous scan results
    setStatus('scanning');
    
    try {
      await NativeModules.PrinterModule.startDiscovery();
      // Auto-refresh paired devices as well
      await refreshPairedDevices();
      
      // Stop scanning after 20 seconds
      setTimeout(() => {
        stopScan();
      }, 20000);
    } catch (e) {
      console.warn('Failed to start discovery:', e);
      setIsScanning(false);
      setStatus(connectedDevice ? 'connected' : 'disconnected');
    }
  };

  const stopScan = async () => {
    try {
      await NativeModules.PrinterModule.stopDiscovery();
    } catch (e) {}
    setIsScanning(false);
    setStatus(connectedDevice ? 'connected' : 'disconnected');
  };

  const connect = async (device: BluetoothDevice) => {
    setStatus('connecting');
    try {
      const hasPerms = await checkPermissions();
      if (!hasPerms) {
        Alert.alert('Permissions Required', 'Bluetooth permissions are needed to connect to printers. Please grant them in app settings.');
        setStatus('disconnected');
        return;
      }

      // Permissions just granted — refresh paired list in case it was empty on startup
      refreshPairedDevices();

      // 1. HARDWARE VERIFICATION
      const { NativeModules } = require('react-native');
      if (NativeModules.PrinterModule?.verifyHardware) {
        try {
          const result = await NativeModules.PrinterModule.verifyHardware(device.address);
          
          // Handle both old string format and new object format
          const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
          
          if (status_code === 'NO_BLUETOOTH') {
            Alert.alert(
              'Bluetooth Disabled',
              'Please enable Bluetooth in your device settings and try again.'
            );
            setStatus('bluetooth_off');
            return;
          }
          
          if (status_code === 'UNREACHABLE') {
            Alert.alert(
              'Printer Not Found',
              `Could not reach printer at ${device.address}. \n\nMake sure:\n• Printer is powered on\n• Printer is paired in Bluetooth settings\n• Printer is not already connected to another device`
            );
            setStatus('failed');
            return;
          }
          
          if (status_code !== 'SUCCESS') {
            Alert.alert('Connection Failed', 'An unexpected error occurred. Please try again.');
            setStatus('failed');
            return;
          }
        } catch (verifyError) {
          console.warn('Hardware verification error:', verifyError);
          Alert.alert('Verification Error', 'Could not verify printer connection. Please try again.');
          setStatus('failed');
          return;
        }
      }

      // 2. PROCEED ONLY ON SUCCESS
      const cleanAddress = device.address.replace(/^BT:|^TCP:|^USB:/, '');
      const cleanDevice = { ...device, address: cleanAddress };

      setConnectedDevice(cleanDevice);
      setStatus('connected');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDevice));
      
      // Haptic feedback for successful connection
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', 'An unexpected error occurred. Please try again.');
      setStatus('disconnected');
    }
  };

  const disconnect = async () => {
    setConnectedDevice(null);
    setStatus('disconnected');
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const printReceipt = async (data: ReceiptData): Promise<boolean> => {
    if (status !== 'connected' || !connectedDevice) {
      console.warn('[BT] printReceipt called but printer not connected');
      return false;
    }
    
    setIsPrinting(true);
    try {
      const result = await printerService.printReceipt(
        { address: connectedDevice.address, name: connectedDevice.name },
        { ...data, shopId }
      );
      return result;
    } finally {
      setIsPrinting(false);
    }
  };

  const testPrint = async (): Promise<boolean> => {
    if (!connectedDevice) {
      Alert.alert('No Printer', 'Please connect a printer first.');
      return false;
    }
    const testData = {
      orderId: 'TEST-' + Math.random().toString(36).substring(2, 7).toUpperCase(),
      items: [
        { name: 'Test Connection', quantity: 1, price: 0.00 }
      ],
      subtotal: 0.00,
      discount: 0,
      total: 0.00,
      paymentMethod: 'Diagnostics',
      employeeName: 'System',
      createdAt: new Date().toISOString(),
      shopId,
    };
    
    const device = connectedDevice;
    setIsPrinting(true);
    try {
      return await printerService.printReceipt(
        { address: device.address, name: device.name },
        testData
      );
    } finally {
      setIsPrinting(false);
    }
  };

  const value = useMemo(() => ({
    connectedDevice,
    status,
    scannedDevices: [...scannedDevices, ...pairedDevices.filter(p => !scannedDevices.find(s => s.address === p.address))],
    pairedDevices,
    startScan,
    stopScan,
    connect,
    disconnect,
    printReceipt,
    testPrint,
    refreshPairedDevices,
    enableBluetooth,
    openSettings,
    isPrinting,
    isScanning,
  }), [connectedDevice, status, scannedDevices, pairedDevices, isPrinting, isScanning]);

  return <BluetoothContext.Provider value={value}>{children}</BluetoothContext.Provider>;
}

export function useBluetooth() {
  const ctx = useContext(BluetoothContext);
  if (!ctx) throw new Error('useBluetooth must be used within BluetoothProvider');
  return ctx;
}
