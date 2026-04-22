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

type ConnectionStatus = 'disconnected' | 'refreshing' | 'connecting' | 'connected' | 'failed' | 'bluetooth_off';

export interface ReceiptData {
  orderId: string;
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  paymentMethod?: string;
  employeeName?: string;
  settings?: {
    businessName?: string;
    address?: string;
    contactTel?: string;
    footerMessage?: string;
    receiptSize?: string;
  };
}

export interface PairedDevice {
  id: string;
  name: string;
  address: string;
}

interface BluetoothContextValue {
  connectedDevice: BluetoothDevice | null;
  status: ConnectionStatus;
  pairedDevices: PairedDevice[];
  refreshPairedDevices: () => Promise<void>;
  enableBluetooth: () => Promise<void>;
  openSettings: () => Promise<void>;
  connect: (device: BluetoothDevice) => Promise<void>;
  disconnect: () => void;
  printReceipt: (data: ReceiptData) => Promise<boolean>;
  testPrint: () => Promise<boolean>;
}

const BluetoothContext = createContext<BluetoothContextValue | null>(null);

const MOCK_DEVICES: BluetoothDevice[] = [];

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const [connectedDevice, setConnectedDevice] = useState<BluetoothDevice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);

  useEffect(() => {
    const initPrinter = async () => {
      const { NativeModules } = require('react-native');
      const module = NativeModules.PrinterModule;

      // 1. Initial Hardware Check
      if (Platform.OS === 'web') {
        setStatus('bluetooth_off');
      } else if (module?.verifyHardware) {
        const check = await module.verifyHardware(""); // Quick BT check
        if (check === 'NO_BLUETOOTH') setStatus('bluetooth_off');
      }

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const device = JSON.parse(stored) as BluetoothDevice;
          setConnectedDevice(device);
          setStatus('connecting');

          // Verify if the stored device is actually reachable
          if (module?.verifyHardware) {
            const result = await module.verifyHardware(device.address);
            if (result === 'SUCCESS') {
              setStatus('connected');
            } else if (result === 'NO_BLUETOOTH') {
              setStatus('bluetooth_off');
            } else {
              setStatus('failed');
            }
          } else if (Platform.OS === 'android') {
            // If on Android but module missing, we can't verify.
            setStatus('failed');
          } else {
            // Web/Other - we already set bluetooth_off above
          }
        } catch (e) {
          console.warn('Failed to restore printer', e);
          AsyncStorage.removeItem(STORAGE_KEY);
          setStatus('disconnected');
        }
      }
    };

    initPrinter();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    
    // For Android 12+ (API 31+), we ONLY need BLUETOOTH_CONNECT to talk to paired devices
    if (Platform.Version >= 31) {
      const { PermissionsAndroid } = require('react-native');
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        results['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
      );
    } 
    
    // For older Android versions, BLUETOOTH and BLUETOOTH_ADMIN are normal permissions (granted at install)
    return true;
  };

  const refreshPairedDevices = async () => {
    const hasPerms = await checkPermissions();
    if (!hasPerms) {
      Alert.alert('Permissions Required', 'Bluetooth connection permission is needed to access paired devices.');
      return;
    }

    setStatus('refreshing');
    setPairedDevices([]);
    
    if ((Platform.OS as any) === 'web') {
      setStatus('disconnected');
      return;
    }

    try {
      // Use our new native bridge to get paired devices
      const devices = await printerService.getPairedDevices();
      setPairedDevices(devices);
      
      if (devices.length > 0) {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
      
      setStatus(connectedDevice ? 'connected' : 'disconnected');
    } catch (error: any) {
      console.warn('Failed to get paired devices', error);
      if (error?.message?.includes('disabled')) {
        setStatus('bluetooth_off');
      } else {
        setStatus('failed');
      }
    }
  };

  const enableBluetooth = async () => {
    try {
      await printerService.enableBluetooth();
      // After requesting, refresh list
      setTimeout(refreshPairedDevices, 1000);
    } catch (e) {
      console.error(e);
    }
  };

  const openSettings = async () => {
    try {
      await printerService.openBluetoothSettings();
    } catch (e) {
      console.error(e);
    }
  };

  const connect = async (device: BluetoothDevice) => {
    setStatus('connecting');
    try {
      const hasPerms = await checkPermissions();
      if (!hasPerms) {
        Alert.alert('Permissions Required', 'Bluetooth connection permission is needed to connect to printers.');
        setStatus('disconnected');
        return;
      }

      // 1. HARDWARE VERIFICATION
      const { NativeModules } = require('react-native');
      const module = NativeModules.PrinterModule;

      if (module?.verifyHardware) {
        const result = await module.verifyHardware(device.address);
        
        if (result === 'NO_BLUETOOTH') {
          setStatus('bluetooth_off');
          Alert.alert('Bluetooth Required', 'Please turn on Bluetooth to connect to the printer.');
          return;
        }
        
        if (result === 'UNREACHABLE') {
          setStatus('failed');
          Alert.alert('Printer Unreachable', 'Could not establish a connection. Please ensure the printer is turned on and paired.');
          return;
        }
      } else if (Platform.OS === 'web') {
        // Prevent false positives on Web/PC
        setStatus('bluetooth_off');
        Alert.alert('Not Supported', 'Bluetooth printing is only supported on the Android application.');
        return;
      } else {
        // On Android but module missing? Probably a dev build issue.
        console.warn('PrinterModule.verifyHardware not found. Check native implementation.');
      }

      // 2. PROCEED ONLY ON SUCCESS
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
    pairedDevices,
    refreshPairedDevices,
    enableBluetooth,
    openSettings,
    connect,
    disconnect,
    printReceipt,
    testPrint,
  }), [connectedDevice, status, pairedDevices]);

  return <BluetoothContext.Provider value={value}>{children}</BluetoothContext.Provider>;
}

export function useBluetooth() {
  const ctx = useContext(BluetoothContext);
  if (!ctx) throw new Error('useBluetooth must be used within BluetoothProvider');
  return ctx;
}
