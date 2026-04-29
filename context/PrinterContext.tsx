import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Platform, Alert, AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { printerService } from '@/lib/printerService';
import { useAuth } from '@/context/AuthContext';

export type ConnectionMode = 'Bluetooth' | 'USB' | 'Network' | 'Wi-Fi';

const STORAGE_KEY = 'pos_active_printer';
const SAVED_PRINTERS_KEY = 'pos_saved_printers';

export interface PrinterDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
  printMode?: ConnectionMode;
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

interface PrinterContextValue {
  connectedDevice: PrinterDevice | null;
  status: ConnectionStatus;
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  scannedDevices: PrinterDevice[]; // always empty — scanning disabled; kept for API compatibility
  pairedDevices: PrinterDevice[];
  usbDevices: PrinterDevice[];
  savedPrinters: PrinterDevice[];
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (device: PrinterDevice, mode?: ConnectionMode) => Promise<void>;
  connectByString: (input: string, mode?: ConnectionMode) => Promise<void>;
  removeSavedPrinter: (address: string) => Promise<void>;
  disconnect: () => void;
  printReceipt: (data: ReceiptData) => Promise<boolean>;
  testPrint: (targetDevice?: PrinterDevice) => Promise<boolean>;
  refreshPairedDevices: () => Promise<void>;
  refreshUsbDevices: () => Promise<void>;
  requestUsbPermission: (deviceName: string) => Promise<boolean>;
  enableBluetooth: () => Promise<boolean>;
  openSettings: () => Promise<boolean>;
  isPrinting: boolean;
  isScanning: boolean;
  openCashDrawer: () => Promise<{ success: boolean; message: string }>;
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: ReactNode }) {
  const { shopId } = useAuth();
  const [connectedDevice, setConnectedDevice] = useState<PrinterDevice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('Bluetooth');
  const [pairedDevices, setPairedDevices] = useState<PrinterDevice[]>([]);
  const [usbDevices, setUsbDevices] = useState<PrinterDevice[]>([]);
  const [savedPrinters, setSavedPrinters] = useState<PrinterDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    const initPrinter = async () => {
      // Load saved mode
      const savedMode = await AsyncStorage.getItem('pos_printer_mode');
      if (savedMode) setConnectionMode(savedMode as ConnectionMode);

      // Load saved printers
      const savedList = await AsyncStorage.getItem(SAVED_PRINTERS_KEY);
      if (savedList) {
        try {
          setSavedPrinters(JSON.parse(savedList));
        } catch (e) {}
      }

      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const device = JSON.parse(stored) as PrinterDevice;
          setConnectedDevice(device);
          setStatus('connecting');

          // Verify if the stored device is actually reachable
          if (NativeModules.PrinterModule?.verifyHardware) {
            try {
              const result = await NativeModules.PrinterModule.verifyHardware(device.address, device.printMode || 'Bluetooth');
              const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
              
              if (status_code === 'SUCCESS') {
                setStatus('connected');
              } else if (status_code === 'NO_BLUETOOTH') {
                setStatus('bluetooth_off');
              } else {
                setStatus('failed');
              }
            } catch (verifyError) {
              setStatus('failed');
            }
          } else {
            setStatus('connected');
          }
        } catch (e) {
          AsyncStorage.removeItem(STORAGE_KEY);
          setStatus('disconnected');
        }
      }
    };

    initPrinter();
    if (connectionMode === 'Bluetooth') refreshPairedDevices();
    if (connectionMode === 'USB') refreshUsbDevices();

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        refreshPairedDevices();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Persistent reconnection logic
  useEffect(() => {
    if (status === 'connected' || status === 'scanning' || status === 'connecting' || status === 'bluetooth_off') return;
    if (!connectedDevice) return;

    const interval = setInterval(async () => {
      if (NativeModules.PrinterModule?.verifyHardware) {
        try {
          const result = await NativeModules.PrinterModule.verifyHardware(connectedDevice.address, connectedDevice.printMode || connectionMode);
          const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
          if (status_code === 'SUCCESS') {
            setStatus('connected');
          }
        } catch (e) {}
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [status, connectedDevice?.address]);

  // NOTE: onDeviceFound listener removed — Bluetooth discovery (startDiscovery) is
  // disabled. We read bonded devices only; no scanning events will ever fire.

  useEffect(() => {
    // Listen for USB status changes from the native Watchdog
    const sub = DeviceEventEmitter.addListener('onUsbStatusChanged', (event) => {
      console.log('[PrinterContext] USB Status Event:', event);
      const { status: usbStatus, deviceName } = event;
      
      if (usbStatus === 'PERMISSION_GRANTED' || usbStatus === 'ATTACHED') {
        refreshUsbDevices();
        // If this is our active printer, try to restore "connected" status
        if (connectedDevice?.address === deviceName) {
           setStatus('connected');
        }
      } else if (usbStatus === 'DETACHED') {
        refreshUsbDevices();
        // If our active printer was just pulled, show connection loss
        if (connectedDevice?.address === deviceName) {
          setStatus('failed');
        }
      }
    });

    return () => {
      sub.remove();
    };
  }, [connectedDevice?.address]);

  useEffect(() => {
    // Listen for Bluetooth status changes (State & Pairing)
    const sub = DeviceEventEmitter.addListener('onBluetoothStatusChanged', (event) => {
      console.log('[PrinterContext] Bluetooth Status Event:', event);
      const { status: btStatus, address } = event;
      
      if (btStatus === 'OFF') {
        setStatus('bluetooth_off');
      } else if (btStatus === 'ON') {
        setStatus(connectedDevice ? 'connected' : 'disconnected');
        refreshPairedDevices();
      } else if (btStatus === 'PAIRED') {
        refreshPairedDevices();
        // If the device just paired was our target, try to finish the connection
        if (connectedDevice?.address === address) {
           setStatus('connected');
        }
      }
    });

    return () => {
      sub.remove();
    };
  }, [connectedDevice?.address]);

  const refreshPairedDevices = async () => {
    try {
      if (Platform.OS === 'android' && Platform.Version >= 31) {
        // Android 12+ (API 31+): request BLUETOOTH_CONNECT to read the bonding table.
        // ACCESS_FINE_LOCATION is NOT needed — we read bondedDevices, not scan.
        const { PermissionsAndroid } = require('react-native');
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        );
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('[PrinterContext] BLUETOOTH_CONNECT permission denied');
          return;
        }
      }
      // Pre-Android 12: bonded device access needs no runtime permission.
      const paired = await printerService.getPairedDevices();
      const formattedPaired = paired.map((d: any) => ({
        id: d.id || d.address,
        name: d.name || 'Bluetooth Printer',
        address: d.address,
        rssi: 0,
        printMode: 'Bluetooth' as ConnectionMode
      }));
      setPairedDevices(formattedPaired);
    } catch (error) {
      console.warn('Failed to refresh paired devices', error);
    }
  };

  const refreshUsbDevices = async () => {
    try {
      const usb = await printerService.getUsbDevices();
      const formattedUsb = usb.map((d: any) => ({
        id: d.id || d.address,
        name: d.name || 'USB Printer',
        address: d.address,
        rssi: 0,
        printMode: 'USB' as ConnectionMode
      }));
      setUsbDevices(formattedUsb);
    } catch (error) {
      console.warn('Failed to refresh USB devices', error);
    }
  };

  const requestUsbPermission = async (deviceName: string) => {
    try {
      return await printerService.requestUsbPermission(deviceName);
    } catch (error) {
      console.warn('Failed to request USB permission', error);
      return false;
    }
  };

  useEffect(() => {
    AsyncStorage.setItem('pos_printer_mode', connectionMode);
    if (connectionMode === 'Bluetooth') refreshPairedDevices();
    if (connectionMode === 'USB') refreshUsbDevices();
  }, [connectionMode]);

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

  /**
   * "startScan" now refreshes the already-paired (bonded) device list.
   * We do NOT call startDiscovery() — that API triggers location permissions.
   * To add a new printer the user must pair it via Android Bluetooth Settings first.
   */
  const startScan = async () => {
    try {
      const hasPerms = await checkPermissions();
      if (!hasPerms) {
        Alert.alert(
          'Bluetooth Permission Required',
          'Nearby Devices permission is required to list paired printers. Please enable it in App Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => openSettings() }
          ]
        );
        return;
      }

      setIsScanning(true);
      setStatus('scanning');
      // Refresh paired devices from OS bonding table — zero scanning, zero location.
      await refreshPairedDevices();
    } catch (e) {
      console.warn('[PrinterContext] Failed to refresh paired devices:', e);
    } finally {
      setIsScanning(false);
      setStatus(connectedDevice ? 'connected' : 'disconnected');
    }
  };

  const stopScan = async () => {
    // Nothing to stop — we are not scanning.
    setIsScanning(false);
    setStatus(connectedDevice ? 'connected' : 'disconnected');
  };

  const connect = async (device: PrinterDevice, mode?: ConnectionMode) => {
    const targetMode = mode || device.printMode || connectionMode;
    setStatus('connecting');
    try {
      if (targetMode === 'Bluetooth') {
        const hasPerms = await checkPermissions();
        if (!hasPerms) {
          Alert.alert('Permissions Required', 'Bluetooth permissions are needed to connect to printers.');
          setStatus('disconnected');
          return;
        }
      }

      if (targetMode === 'USB') {
        await requestUsbPermission(device.address);
      }

      // 1. HARDWARE VERIFICATION
      if (NativeModules.PrinterModule?.verifyHardware) {
        try {
          const result = await NativeModules.PrinterModule.verifyHardware(device.address, targetMode);
          const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
          
          if (status_code === 'NO_BLUETOOTH' && targetMode === 'Bluetooth') {
            Alert.alert('Bluetooth Disabled', 'Please enable Bluetooth and try again.');
            setStatus('bluetooth_off');
            return;
          }
          
          if (status_code === 'UNREACHABLE') {
            Alert.alert('Printer Not Found', `Could not reach printer at ${device.address} via ${targetMode}.`);
            setStatus('failed');
            return;
          }
          
          if (status_code !== 'SUCCESS') {
            setStatus('failed');
            return;
          }
        } catch (verifyError) {
          setStatus('failed');
          return;
        }
      }

      // 2. PROCEED ONLY ON SUCCESS
      const cleanAddress = device.address.replace(/^BT:|^TCP:|^USB:/, '');
      const cleanDevice = { ...device, address: cleanAddress, printMode: targetMode };

      setConnectedDevice(cleanDevice);
      setStatus('connected');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDevice));
      
      setSavedPrinters(prev => {
        if (prev.find(p => p.address === cleanDevice.address && p.printMode === targetMode)) return prev;
        const newList = [cleanDevice, ...prev];
        AsyncStorage.setItem(SAVED_PRINTERS_KEY, JSON.stringify(newList));
        return newList;
      });
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (error) {
      console.error('Connection error:', error);
      setStatus('disconnected');
    }
  };

  const connectByString = async (input: string, mode?: ConnectionMode) => {
    const targetMode = mode || connectionMode;
    let name = 'Network Printer';
    let address = input.trim();

    if (targetMode === 'Bluetooth') {
      const parts = input.split(' - ');
      if (parts.length >= 2) {
        name = parts[0].trim();
        address = parts[parts.length - 1].trim();
      }
      
      // Fix 6: MAC address validation for manual entry
      const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
      if (!MAC_REGEX.test(address)) {
        throw new Error('Invalid Bluetooth address. Expected format: XX:XX:XX:XX:XX:XX');
      }
    }

    await connect({
      id: address,
      name,
      address,
      rssi: 0,
      printMode: targetMode
    }, targetMode);
  };

  const removeSavedPrinter = async (address: string) => {
    setSavedPrinters(prev => {
      const newList = prev.filter(p => p.address !== address);
      AsyncStorage.setItem(SAVED_PRINTERS_KEY, JSON.stringify(newList));
      return newList;
    });
  };

  const disconnect = async () => {
    setConnectedDevice(null);
    setStatus('disconnected');
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const printReceipt = async (data: ReceiptData): Promise<boolean> => {
    if (!connectedDevice) {
      console.warn('[Printer] printReceipt called but no printer is configured');
      return false;
    }
    
    setIsPrinting(true);
    try {
      const result = await printerService.printReceipt(
        { 
          address: connectedDevice.address, 
          name: connectedDevice.name,
          printMode: connectedDevice.printMode || connectionMode
        } as any,
        { ...data, shopId }
      );
      return result;
    } finally {
      setIsPrinting(false);
    }
  };

  const testPrint = async (targetDevice?: PrinterDevice): Promise<boolean> => {
    const device = targetDevice || connectedDevice;
    if (!device) {
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

  const openCashDrawer = async (): Promise<{ success: boolean; message: string }> => {
    if (!connectedDevice) return { success: false, message: 'No printer connected' };
    try {
      return await printerService.openCashDrawer(
        connectedDevice.address, 
        connectedDevice.printMode || connectionMode
      );
    } catch (err) {
      return { success: false, message: String(err) };
    }
  };

  const value = useMemo(() => ({
    connectedDevice,
    status,
    connectionMode,
    setConnectionMode,
    scannedDevices: [] as PrinterDevice[], // scanning disabled — always empty
    pairedDevices,
    usbDevices,
    savedPrinters,
    startScan,
    stopScan,
    connect,
    connectByString,
    removeSavedPrinter,
    disconnect,
    printReceipt,
    testPrint,
    refreshPairedDevices,
    refreshUsbDevices,
    requestUsbPermission,
    enableBluetooth,
    openSettings,
    isPrinting,
    isScanning,
    openCashDrawer,
  }), [
    connectedDevice,
    status,
    connectionMode,
    pairedDevices,
    usbDevices,
    savedPrinters,
    isPrinting,
    isScanning
  ]);

  return <PrinterContext.Provider value={value}>{children}</PrinterContext.Provider>;
}

export function usePrinter() {
  const ctx = useContext(PrinterContext);
  if (!ctx) throw new Error('usePrinter must be used within PrinterProvider');
  return ctx;
}
