import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
  Alert,
  Linking,
  RefreshControl,
  ActivityIndicator,
  Switch,
  NativeModules,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence,
  FadeIn,
  FadeOut
} from 'react-native-reanimated';
import { usePrinter, PrinterDevice, ConnectionMode } from '@/context/PrinterContext';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

const C = Colors.dark;

function EditPrinterView({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { shopId } = useAuth();
  const { 
    pairedDevices, 
    usbDevices,
    savedPrinters,
    isScanning, 
    startScan, 
    stopScan, 
    connect, 
    connectByString,
    removeSavedPrinter,
    disconnect, 
    connectedDevice,
    testPrint,
    openSettings,
    connectionMode: contextMode,
    setConnectionMode: setContextMode,
    refreshUsbDevices,
    requestUsbPermission,
    refreshPairedDevices
  } = usePrinter();

  const [name, setName] = useState('POS');
  const [model, setModel] = useState('OTHER MODEL');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [mode, setMode] = useState<ConnectionMode>(contextMode || 'Bluetooth');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<PrinterDevice | null>(null);
  const [deviceInput, setDeviceInput] = useState('');
  const [networkIp, setNetworkIp] = useState('');
  const [networkPort, setNetworkPort] = useState('9100');
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [paperSize, setPaperSize] = useState<'58mm' | '80mm'>('58mm');
  const [showPaperSizeDropdown, setShowPaperSizeDropdown] = useState(false);
  
  const [printReceipts, setPrintReceipts] = useState(true);
  const [styledHeader, setStyledHeader] = useState(false);
  const [cashDrawer, setCashDrawer] = useState(false);
  const [autoPrint, setAutoPrint] = useState(true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [printMode, setPrintMode] = useState('Text');
  const [showPrintModeDropdown, setShowPrintModeDropdown] = useState(false);
  const [extraSpace, setExtraSpace] = useState('10mm');
  const [showExtraSpaceDropdown, setShowExtraSpaceDropdown] = useState(false);
  const [drawerCmds, setDrawerCmds] = useState('1B,70,00,3C,FF');


  useEffect(() => {
    (async () => {
      try {
        const { getReceiptDesign } = await import('@/lib/offlineDb');
        const design = await getReceiptDesign(shopId);
        if (design) {
          setName(design.printer_name || 'POS');
          setPaperSize((design.receipt_size as '58mm' | '80mm') || '58mm');
          setAutoPrint(design.auto_print ?? true);
          setStyledHeader(design.styled_header ?? false);
          setCashDrawer(design.cash_drawer ?? false);
          if (design.print_mode) setPrintMode(design.print_mode);
          if (design.extra_space) setExtraSpace(design.extra_space);
          if (design.drawer_cmds) setDrawerCmds(design.drawer_cmds);
        }
      } catch (e) {}
    })();
    
    if (connectedDevice?.printMode === 'Network' || connectedDevice?.printMode === 'Wi-Fi') {
      const [ip, port] = connectedDevice.address.split(':');
      setNetworkIp(ip);
      if (port) setNetworkPort(port);
    }
  }, [shopId, connectedDevice]);

  useEffect(() => {
    const targetDevice = selectedDevice || connectedDevice;
    if (Platform.OS === 'android' && targetDevice && NativeModules.PrinterModule?.verifyHardware) {
      (async () => {
        try {
          const result = await NativeModules.PrinterModule.verifyHardware(targetDevice.address, targetDevice.printMode || 'Bluetooth');
          const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
          if (status_code === 'BONDING_REQUIRED' || status_code === 'UNREACHABLE' || status_code === 'NO_BLUETOOTH') {
            Alert.alert(
              'Printer is not paired',
              'Click OK to go to device settings to pair the printer.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'OK', onPress: () => openSettings() }
              ]
            );
          }
        } catch (e) { }
      })();
    }
  }, [connectedDevice?.address, selectedDevice?.address]);

  const handleSave = async (closeAll = true) => {
    setSaving(true);
    try {
      const { saveReceiptDesign } = await import('@/lib/offlineDb');
      await saveReceiptDesign({
        id: shopId || 'default',
        shop_id: shopId || null,
        printer_name: name,
        receipt_size: paperSize,
        auto_print: autoPrint,
        styled_header: styledHeader,
        cash_drawer: cashDrawer,
        print_mode: printMode,
        extra_space: extraSpace,
        drawer_cmds: drawerCmds,
      });

      setContextMode(mode);

      if (mode === 'Network' || mode === 'Wi-Fi') {
        if (networkIp) {
          await connect({
            id: networkIp,
            name: name,
            address: `${networkIp}:${networkPort}`,
            rssi: 0,
            printMode: mode
          }, mode);
        }
      } else if (selectedDevice) {
        await connect(selectedDevice, mode);
      } else if (deviceInput.includes(' - ')) {
        try {
          await connectByString(deviceInput, mode);
        } catch (e: any) {
          Alert.alert('Invalid Address', e.message);
        }
      }
      
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (closeAll) {
        onBack();
      } else {
        setShowAdvancedSettings(false);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save printer settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const targetDevice = selectedDevice || connectedDevice;
    if (!targetDevice) {
      Alert.alert('No Printer', 'Please select a device to test print.');
      return;
    }

    setTesting(true);
    try {
      if (Platform.OS === 'android' && targetDevice && NativeModules.PrinterModule?.verifyHardware) {
        const result = await NativeModules.PrinterModule.verifyHardware(targetDevice.address, targetDevice.printMode || 'Bluetooth');
        const status_code = typeof result === 'string' ? result : result?.status || 'UNREACHABLE';
        
        if (status_code === 'BONDING_REQUIRED' || status_code === 'UNREACHABLE' || status_code === 'NO_BLUETOOTH') {
          Alert.alert(
            'Printer is not paired',
            'Click OK to go to device settings to pair the printer.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setTesting(false) },
              { text: 'OK', onPress: () => {
                setTesting(false);
                openSettings();
              }}
            ]
          );
          return;
        }
      }
      
      const success = await testPrint(targetDevice);
      if (success) {
        Alert.alert('Test Print Successful', 'Your printer is working correctly.');
      } else {
        Alert.alert('Test Print Failed', 'Could not reach the printer. Check the connection and try again.');
      }
    } catch (e) {
      Alert.alert('Test Print Failed', 'Could not reach the printer. Check the connection and try again.');
      console.warn('Test print error', e);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Printer', 'Are you sure you want to remove this printer configuration?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        disconnect();
        onBack();
      }}
    ]);
  };

  if (showAdvancedSettings) {
    return (
      <View style={[styles.root, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
        <View style={[styles.header, { backgroundColor: '#1976D2', borderBottomWidth: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={() => setShowAdvancedSettings(false)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <Text style={[styles.headerTitle, { color: '#fff' }]}>Advanced settings</Text>
          </View>
          <Pressable onPress={() => handleSave(false)} style={{ paddingHorizontal: 12 }}>
            <Text style={{ fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>SAVE</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { backgroundColor: '#cfd8dc' }]}>
          <View style={styles.editRow}>
            <Text style={[styles.editLabel, { color: '#546e7a' }]}>Print mode</Text>
            <Pressable style={[styles.editDropdown, { borderBottomColor: '#b0bec5' }]} onPress={() => setShowPrintModeDropdown(!showPrintModeDropdown)}>
              <Text style={[styles.editValue, { color: '#37474f' }]}>{printMode}</Text>
              <Ionicons name={showPrintModeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#78909c" />
            </Pressable>
            {showPrintModeDropdown && (
              <View style={styles.dropdownList}>
                {['Text', 'Image'].map(opt => (
                  <Pressable 
                    key={opt} 
                    style={[styles.dropdownItem, printMode === opt && styles.dropdownItemActive]}
                    onPress={() => { setPrintMode(opt); setShowPrintModeDropdown(false); }}
                  >
                    <Text style={[styles.dropdownItemText, printMode === opt && { color: C.accent }]}>{opt}</Text>
                    {printMode === opt && <Ionicons name="checkmark" size={18} color={C.accent} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.editRow}>
            <Text style={[styles.editLabel, { color: '#546e7a' }]}>Extra space for receipt edge</Text>
            <Pressable style={[styles.editDropdown, { borderBottomColor: '#b0bec5' }]} onPress={() => setShowExtraSpaceDropdown(!showExtraSpaceDropdown)}>
              <Text style={[styles.editValue, { color: '#37474f' }]}>{extraSpace}</Text>
              <Ionicons name={showExtraSpaceDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#78909c" />
            </Pressable>
            {showExtraSpaceDropdown && (
              <View style={styles.dropdownList}>
                {['0mm', '5mm', '10mm', '15mm', '20mm'].map(opt => (
                  <Pressable 
                    key={opt} 
                    style={[styles.dropdownItem, extraSpace === opt && styles.dropdownItemActive]}
                    onPress={() => { setExtraSpace(opt); setShowExtraSpaceDropdown(false); }}
                  >
                    <Text style={[styles.dropdownItemText, extraSpace === opt && { color: C.accent }]}>{opt}</Text>
                    {extraSpace === opt && <Ionicons name="checkmark" size={18} color={C.accent} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.editRow}>
            <Text style={[styles.editLabel, { color: '#546e7a' }]}>Paper size</Text>
            <Pressable style={[styles.editDropdown, { borderBottomColor: '#b0bec5' }]} onPress={() => setShowPaperSizeDropdown(!showPaperSizeDropdown)}>
              <Text style={[styles.editValue, { color: '#37474f' }]}>{paperSize}</Text>
              <Ionicons name={showPaperSizeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#78909c" />
            </Pressable>
            {showPaperSizeDropdown && (
              <View style={styles.dropdownList}>
                {['58mm', '80mm'].map(opt => (
                  <Pressable 
                    key={opt} 
                    style={[styles.dropdownItem, paperSize === opt && styles.dropdownItemActive]}
                    onPress={() => { setPaperSize(opt as '58mm' | '80mm'); setShowPaperSizeDropdown(false); }}
                  >
                    <Text style={[styles.dropdownItemText, paperSize === opt && { color: C.accent }]}>{opt}</Text>
                    {paperSize === opt && <Ionicons name="checkmark" size={18} color={C.accent} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.editRow}>
            <Text style={[styles.editLabel, { color: '#546e7a' }]}>Drawer ESC/POS commands</Text>
            <TextInput 
              style={[styles.editInput, { color: '#37474f', borderBottomColor: '#b0bec5' }]} 
              value={drawerCmds} 
              onChangeText={setDrawerCmds} 
              placeholderTextColor="#78909c"
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
      <View style={[styles.header, { backgroundColor: C.accent, borderBottomWidth: 0 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable onPress={onBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={[styles.headerTitle, { color: '#fff' }]}>Edit printer</Text>
        </View>
        <Pressable onPress={() => handleSave(true)} disabled={saving} style={{ paddingHorizontal: 12 }}>
          <Text style={{ fontFamily: 'Inter_700Bold', color: '#fff', fontSize: 16 }}>{saving ? '...' : 'SAVE'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { backgroundColor: C.background }]}>
        <View style={styles.editRow}>
          <Text style={styles.editLabel}>Printer name</Text>
          <TextInput 
            style={styles.editInput} 
            value={name} 
            onChangeText={setName} 
            placeholderTextColor={C.textMuted}
          />
        </View>

        <View style={styles.editRow}>
          <Text style={styles.editLabel}>Printer model</Text>
          <Pressable style={styles.editDropdown} onPress={() => setShowModelDropdown(!showModelDropdown)}>
            <Text style={styles.editValue}>{model}</Text>
            <Ionicons name={showModelDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
          </Pressable>
          {showModelDropdown && (
            <View style={styles.dropdownList}>
              {['OTHER MODEL', 'GENERIC POS', 'SUNMI V2'].map(opt => (
                <Pressable 
                  key={opt} 
                  style={[styles.dropdownItem, model === opt && styles.dropdownItemActive]}
                  onPress={() => { setModel(opt); setShowModelDropdown(false); }}
                >
                  <Text style={[styles.dropdownItemText, model === opt && { color: C.accent }]}>{opt}</Text>
                  {model === opt && <Ionicons name="checkmark" size={18} color={C.accent} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.editRow}>
          <Text style={styles.editLabel}>Connection mode</Text>
          <Pressable style={styles.editDropdown} onPress={() => setShowModeDropdown(!showModeDropdown)}>
            <Text style={styles.editValue}>{mode}</Text>
            <Ionicons name={showModeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
          </Pressable>
          {showModeDropdown && (
            <View style={styles.dropdownList}>
              {(['Bluetooth', 'USB', 'Network / Wi-Fi'] as const).map(opt => {
                // Map the combined label back to the correct ConnectionMode value
                const modeValue: ConnectionMode = opt === 'Network / Wi-Fi' ? 'Network' : opt;
                return (
                  <Pressable 
                    key={opt} 
                    style={[styles.dropdownItem, mode === modeValue && styles.dropdownItemActive]}
                    onPress={() => { setMode(modeValue); setShowModeDropdown(false); }}
                  >
                    <Text style={[styles.dropdownItemText, mode === modeValue && { color: C.accent }]}>{opt}</Text>
                    {mode === modeValue && <Ionicons name="checkmark" size={18} color={C.accent} />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.editRow}>
          {mode === 'Network' || mode === 'Wi-Fi' ? (
            <>
              <Text style={styles.editLabel}>Printer IP Address & Port</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  style={[styles.editInput, { flex: 2 }]}
                  value={networkIp}
                  onChangeText={setNetworkIp}
                  placeholder="192.168.1.100"
                  placeholderTextColor={C.textMuted}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.editInput, { flex: 1 }]}
                  value={networkPort}
                  onChangeText={setNetworkPort}
                  placeholder="9100"
                  placeholderTextColor={C.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.editLabel}>Device ({mode === 'Bluetooth' ? 'Paired devices' : 'Connected USB'})</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={styles.editInput}
                    value={deviceInput || (selectedDevice ? `${selectedDevice.name} - ${selectedDevice.address}` : (connectedDevice && connectedDevice.printMode === mode) ? `${connectedDevice.name} - ${connectedDevice.address}` : '')}
                    onChangeText={(txt) => {
                      setDeviceInput(txt);
                      setSelectedDevice(null);
                      if (!showDeviceDropdown) setShowDeviceDropdown(true);
                    }}
                    onFocus={() => setShowDeviceDropdown(true)}
                    placeholder={mode === 'Bluetooth' ? "Name - XX:XX:XX:XX:XX:XX" : "Select USB device"}
                    placeholderTextColor={C.textMuted}
                    editable={mode === 'Bluetooth'}
                  />
                  <Pressable 
                    style={{ position: 'absolute', right: 0, top: 12 }}
                    onPress={() => setShowDeviceDropdown(!showDeviceDropdown)}
                  >
                    <Ionicons name={showDeviceDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
                  </Pressable>
                </View>
                {mode === 'Bluetooth' && (
                  <Pressable 
                    style={styles.inlineSearchBtn} 
                    onPress={async () => {
                      if (isScanning) {
                        stopScan();
                      } else {
                        await startScan();
                        Alert.alert(
                          'Debug: Paired Devices',
                          `Found ${pairedDevices.length} paired device(s).\n\n` +
                          (pairedDevices.map(d => `${d.name} — ${d.address}`).join('\n') || 'None found.')
                        );
                      }
                    }}
                    disabled={isScanning}
                  >
                    <Ionicons name="refresh" size={18} color="#fff" />
                    <Text style={styles.inlineSearchBtnText}>{isScanning ? '...' : 'REFRESH'}</Text>
                  </Pressable>
                )}
                {mode === 'USB' && (
                  <Pressable 
                    style={styles.inlineSearchBtn} 
                    onPress={refreshUsbDevices}
                  >
                    <Ionicons name="refresh" size={18} color="#fff" />
                    <Text style={styles.inlineSearchBtnText}>SCAN</Text>
                  </Pressable>
                )}
              </View>
              {showDeviceDropdown && (
                <View style={styles.dropdownList}>
                  {(mode === 'Bluetooth' ? pairedDevices : usbDevices).map((device: PrinterDevice) => {
                    const isSelected = selectedDevice?.address === device.address || (!selectedDevice && connectedDevice?.address === device.address && connectedDevice?.printMode === mode);
                    
                    return (
                      <View key={device.address} style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}>
                        <Pressable 
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                          onPress={async () => { 
                            if (mode === 'USB') {
                              await requestUsbPermission(device.address);
                            }
                            setSelectedDevice(device); 
                            setDeviceInput('');
                            setShowDeviceDropdown(false); 
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.dropdownItemText, isSelected && { color: C.accent }]} numberOfLines={1}>
                              {device.name}
                            </Text>
                            <Text style={{ fontSize: 11, color: C.textMuted }}>{device.address}</Text>
                          </View>
                          {isSelected && <Ionicons name="checkmark" size={18} color={C.accent} />}
                        </Pressable>
                      </View>
                    );
                  })}
                  {mode === 'Bluetooth' && deviceInput.length > 0 && (
                    <Pressable 
                      style={styles.dropdownItem}
                      onPress={() => {
                        setShowDeviceDropdown(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, { color: C.accent }]}>
                        Manual: {deviceInput}
                      </Text>
                      <Ionicons name="add-circle-outline" size={18} color={C.accent} />
                    </Pressable>
                  )}
                </View>
              )}
            </>
          )}
          <Text style={styles.editHint}>
            {mode === 'Network' || mode === 'Wi-Fi' 
              ? 'Enter the static IP address of your printer. Ensure both devices are on the same network.' 
              : mode === 'Bluetooth'
              ? 'Select a paired Bluetooth printer. To add a new printer, tap the Bluetooth Settings icon and pair it first, then press REFRESH.'
              : `Select your ${mode} printer from the list.`}
          </Text>
        </View>

        <View style={styles.editRow}>
          <Text style={styles.editLabel}>Paper size</Text>
          <Pressable style={styles.editDropdown} onPress={() => setShowPaperSizeDropdown(!showPaperSizeDropdown)}>
            <Text style={styles.editValue}>{paperSize}</Text>
            <Ionicons name={showPaperSizeDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
          </Pressable>
          {showPaperSizeDropdown && (
            <View style={styles.dropdownList}>
              {['58mm', '80mm'].map(opt => (
                <Pressable 
                  key={opt} 
                  style={[styles.dropdownItem, paperSize === opt && styles.dropdownItemActive]}
                  onPress={() => { setPaperSize(opt as '58mm' | '80mm'); setShowPaperSizeDropdown(false); }}
                >
                  <Text style={[styles.dropdownItemText, paperSize === opt && { color: C.accent }]}>{opt}</Text>
                  {paperSize === opt && <Ionicons name="checkmark" size={18} color={C.accent} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={{ marginTop: 10 }}>
          <Pressable style={styles.advancedLink} onPress={() => setShowAdvancedSettings(true)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.advancedTitle}>Advanced settings</Text>
              <Text style={styles.advancedSub}>Click here to view advance settings.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
          </Pressable>
        </View>

        <View style={styles.toggleGroup}>
          <View style={styles.toggleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.toggleLabel}>Print receipts and bills</Text>
              <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            </View>
            <Switch 
              value={printReceipts} 
              onValueChange={setPrintReceipts} 
              thumbColor={printReceipts ? C.accent : '#f4f3f4'} 
              trackColor={{ false: C.border, true: C.accentDim }} 
            />
          </View>

          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.toggleLabel}>Styled header</Text>
                <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
              </View>
              <Switch value={styledHeader} onValueChange={setStyledHeader} thumbColor={styledHeader ? C.accent : '#f4f3f4'} trackColor={{ false: C.border, true: C.accentDim }} />
            </View>
            
            <View style={[styles.toggleRow, { marginTop: 16 }]}>
              <Text style={styles.toggleLabel}>Connect cash drawer with printer</Text>
              <Switch value={cashDrawer} onValueChange={setCashDrawer} thumbColor={cashDrawer ? C.accent : '#f4f3f4'} trackColor={{ false: C.border, true: C.accentDim }} />
            </View>

            <View style={[styles.toggleRow, { marginTop: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.toggleLabel}>Automatically print receipt</Text>
                <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
              </View>
              <Switch value={autoPrint} onValueChange={setAutoPrint} thumbColor={autoPrint ? C.accent : '#f4f3f4'} trackColor={{ false: C.border, true: C.accentDim }} />
            </View>
          </View>
        </View>

        <View style={{ gap: 12, marginTop: 10 }}>
          <Pressable style={styles.editActionBtn} onPress={handleTest} disabled={testing}>
             <MaterialCommunityIcons name="printer-pos-plus" size={20} color={C.accent} />
             <Text style={styles.editActionBtnText}>{testing ? 'PRINTING...' : 'TEST PRINT'}</Text>
          </Pressable>

          <Pressable style={[styles.editActionBtn, { borderColor: C.danger }]} onPress={handleDelete}>
             <MaterialCommunityIcons name="delete-outline" size={20} color={C.danger} />
             <Text style={[styles.editActionBtnText, { color: C.danger }]}>DELETE</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { employee, shopId: contextShopId, updateShopId, logout } = useAuth();
  const [posId, setPosId] = useState<string>('');
  const [posSaved, setPosSaved] = useState(false);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const { listShops } = await import('@/lib/settings');
      const list = await listShops();
      setShops(list);
    } catch (e) {
      console.warn('[Settings] refresh error:', e);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (contextShopId) setPosId(contextShopId);
    refresh();
  }, [contextShopId]);

  const handleSavePos = async (idToSave?: string) => {
    const trimmed = (idToSave ?? posId).trim();
    if (trimmed.length === 0) {
      await updateShopId(null);
      setPosId('');
    } else {
      await updateShopId(trimmed);
      setPosId(trimmed);
    }
    setPosSaved(true);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setPosSaved(false), 2500);
  };

  const isAdmin = employee?.role?.toLowerCase() === 'admin';

  const [showEditPrinter, setShowEditPrinter] = useState(false);

  if (showEditPrinter) {
    return <EditPrinterView onBack={() => setShowEditPrinter(false)} />;
  }

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={C.accent}
            colors={[C.accent]}
          />
        }
      >
        {isAdmin && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.headerIconBg}>
                <MaterialCommunityIcons name="storefront-outline" size={18} color={C.accent} />
              </View>
              <Text style={styles.sectionTitle}>Terminal / Shop</Text>
            </View>
            <Text style={styles.settingLabel}>Select or enter POS ID</Text>
            {shops.length > 0 && (
              <View style={{ marginBottom: 10 }}>
                {shops.map(s => (
                  <Pressable
                    key={s.id}
                    style={[
                      styles.shopRow,
                      posId === s.id && styles.shopRowSelected,
                    ]}
                    onPress={() => handleSavePos(s.id)}
                  >
                    <Text style={styles.shopRowText}>{s.name} ({s.id})</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.manualRow}>
              <TextInput
                style={[styles.textInput, { flex: 1 }]}
                value={posId}
                onChangeText={setPosId}
                placeholder="e.g. POS-01"
                placeholderTextColor={C.textMuted}
              />
              <Pressable
                onPress={() => handleSavePos()}
                style={[styles.manualSaveBtn, !posId.trim() && styles.manualSaveBtnDisabled]}
                disabled={!posId.trim() && !posSaved}
              >
                <Text style={styles.manualSaveBtnText}>{posSaved ? 'Saved!' : 'Set'}</Text>
              </Pressable>
            </View>
          </View>
        )}
        <BluetoothSection onEdit={() => setShowEditPrinter(true)} />

        <PinSection />
        <AboutSection />
      </ScrollView>
    </View>
  );
}

const PulsingIndicator = ({ color }: { color: string }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.6, { duration: 1000 }),
        withTiming(1, { duration: 1000 })
      ),
      -1
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1000 }),
        withTiming(0.6, { duration: 1000 })
      ),
      -1
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.pulseContainer}>
      <Animated.View style={[styles.pulseCircle, { backgroundColor: color }, animatedStyle]} />
      <View style={[styles.staticCircle, { backgroundColor: color }]} />
    </View>
  );
};

function BluetoothSection({ onEdit }: { onEdit: () => void }) {
  const { 
    connectedDevice, 
    disconnect, 
    connect,
    pairedDevices, 
    status, 
    testPrint, 
    refreshPairedDevices,
    enableBluetooth,
    openSettings,
    startScan,
    stopScan,
    isScanning,
    connectionMode
  } = usePrinter();
  
  const [printerName, setPrinterName] = useState('');
  const [printerAddress, setPrinterAddress] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  const openSystemSettings = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === 'android') {
      const success = await openSettings();
      if (!success) {
        Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {
          Alert.alert('Bluetooth Settings', 'Please open system settings to manage Bluetooth devices.');
        });
      }
    } else {
      Linking.openURL('App-Prefs:Bluetooth').catch(() => {
        Alert.alert('Bluetooth Settings', 'Please open system settings to manage Bluetooth devices.');
      });
    }
  };

  const handleTestPrint = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTesting(true);
    setTestMessage('Sending test print...');
    try {
      const success = await testPrint();
      if (success) {
        Alert.alert('Test Print Successful', 'Your printer is working correctly.');
        setTestMessage('✓ Test print successful!');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => setTestMessage(''), 3000);
      } else {
        Alert.alert('Test Print Failed', 'Could not reach the printer. Check the connection and try again.');
        setTestMessage('✗ Print failed - check connection');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => setTestMessage(''), 4000);
      }
    } catch (err) {
      Alert.alert('Test Print Failed', 'Could not reach the printer. Check the connection and try again.');
      setTestMessage('✗ Unexpected error');
      setTimeout(() => setTestMessage(''), 4000);
    } finally {
      setTesting(false);
    }
  };

  const handleManualConnect = () => {
    if (!printerAddress.trim()) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    connect({
      id: printerAddress,
      name: printerName || 'Custom Printer',
      address: printerAddress,
      rssi: -60
    });
    setSaved(true);
    setPrinterAddress('');
    setPrinterName('');
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSelectDevice = (device: any) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    connect(device);
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return C.success;
      case 'connecting': return C.accent;
      case 'failed': return C.danger;
      case 'bluetooth_off': return C.warning;
      default: return C.textMuted;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'connected': return 'Ready • Verified';
      case 'connecting': return 'Verifying...';
      case 'failed': return 'Connection Lost';
      case 'bluetooth_off': return 'Bluetooth Off';
      case 'scanning': return 'Discovery Active';
      default: return 'Disconnected';
    }
  };

  const handleScan = () => {
    if (isScanning) {
      stopScan();
    } else {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      startScan();
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.headerIconBg}>
          <MaterialCommunityIcons name="printer-pos" size={18} color={C.accent} />
        </View>
        <Text style={styles.sectionTitle}>Thermal Printer</Text>
      </View>

      {connectedDevice ? (
        <LinearGradient
          colors={status === 'connected' ? [C.accent + '25', C.card] : [C.warning + '15', C.card]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.connectionCard}
        >
          <View style={styles.cardInfo}>
            <View style={styles.statusDotRow}>
              <PulsingIndicator color={getStatusColor()} />
              <Text style={[styles.statusText, { color: getStatusColor() }]}>{getStatusMessage()}</Text>
            </View>
            <Text style={styles.deviceName}>{connectedDevice.name}</Text>
            <Text style={styles.deviceAddress}>{connectedDevice.address}</Text>
          </View>
          
          <View style={styles.cardActions}>
            <Pressable 
              onPress={handleTestPrint} 
              disabled={testing || status !== 'connected'}
              style={({ pressed }) => [styles.glassBtn, pressed && { backgroundColor: C.accent + '20' }]}
            >
              {testing ? <ActivityIndicator size="small" color={C.accent} /> : <Feather name="printer" size={18} color={C.accent} />}
              <Text style={styles.glassBtnText}>Test</Text>
            </Pressable>
            
            <Pressable 
              onPress={disconnect} 
              style={({ pressed }) => [styles.glassBtn, pressed && { backgroundColor: C.danger + '20' }]}
            >
              <MaterialCommunityIcons name="link-variant-off" size={18} color={C.danger} />
              <Text style={[styles.glassBtnText, { color: C.danger }]}>Disconnect</Text>
            </Pressable>
          </View>

          {testMessage ? (
            <Animated.View 
              entering={FadeIn}
              exiting={FadeOut}
              style={[styles.toast, { backgroundColor: testMessage.includes('✓') ? C.success + '30' : C.danger + '30' }]}
            >
              <Text style={[styles.toastText, { color: testMessage.includes('✓') ? C.success : C.danger }]}>
                {testMessage}
              </Text>
            </Animated.View>
          ) : null}
        </LinearGradient>
      ) : null}

      {pairedDevices.length > 0 && (
        <View style={{ marginTop: 12 }}>
          {pairedDevices.map((device: PrinterDevice) => (
            <Pressable
              key={device.id}
              style={[
                styles.posDeviceCard,
                connectedDevice?.address === device.address && styles.posDeviceCardSelected
              ]}
              onPress={onEdit}
            >
              <View style={styles.posDeviceHeader}>
                <Text style={styles.posDeviceName}>{device.name}</Text>
                <Text style={styles.posReceiptLabel}>Receipt</Text>
              </View>
              
              <View style={styles.posDeviceDetail}>
                <Text style={styles.posDetailLabel}>Connection mode : </Text>
                <Text style={styles.posDetailValue}>{device.printMode || 'Bluetooth'}</Text>
              </View>
              
              <View style={styles.posDeviceDetail}>
                <Text style={styles.posDetailLabel}>Device : </Text>
                <Text style={styles.posDetailValue}>{device.address}</Text>
              </View>

              {connectedDevice?.address === device.address && (
                <View style={styles.posPairedBadge}>
                  <Text style={styles.posPairedBadgeText}>PAIRED</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <Pressable 
        onPress={onEdit} 
        style={({ pressed }) => [
          styles.posDeviceCard, 
          { 
            borderStyle: connectedDevice ? 'solid' : 'dashed', 
            opacity: pressed ? 0.7 : 1,
            borderColor: connectedDevice ? C.accent : (isScanning ? C.accent : C.border)
          },
        ]}
      >
        <View style={styles.posDeviceHeader}>
          <Text style={[styles.posDeviceName, connectedDevice && { color: C.accent }]}>
            {connectedDevice ? connectedDevice.name.toUpperCase() : (isScanning ? 'SCANNING FOR DEVICES...' : 'LINK THERMAL PRINTER')}
          </Text>
          {isScanning ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Text style={styles.posReceiptLabel}>Receipt</Text>
          )}
        </View>
        
        <View style={styles.posDeviceDetail}>
          <Text style={styles.posDetailLabel}>Connection mode : </Text>
          <Text style={styles.posDetailValue}>{connectedDevice?.printMode || connectionMode}</Text>
        </View>
        
        <View style={styles.posDeviceDetail}>
          <Text style={styles.posDetailLabel}>Status : </Text>
          <Text style={[styles.posDetailValue, connectedDevice && { color: C.success, fontFamily: 'Inter_700Bold' }]}>
            {connectedDevice ? 'Connected & Ready' : (isScanning ? 'Discovery in progress' : 'No printer connected')}
          </Text>
        </View>

        {connectedDevice && (
          <View style={styles.posDeviceDetail}>
            <Text style={styles.posDetailLabel}>Address : </Text>
            <Text style={styles.posDetailValue}>{connectedDevice.address}</Text>
          </View>
        )}

        {!isScanning && (
          <View style={styles.posPairedBadge}>
            <Text style={styles.posPairedBadgeText}>{connectedDevice ? 'TAP TO MANAGE' : 'TAP TO SEARCH'}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function PinSection() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.headerIconBg}>
          <MaterialCommunityIcons name="lock-outline" size={18} color={C.accent} />
        </View>
        <Text style={styles.sectionTitle}>Access PIN</Text>
      </View>
      <View style={styles.pinInfoCard}>
        <MaterialCommunityIcons name="shield-key-outline" size={32} color={C.accent} style={{ marginBottom: 8 }} />
        <Text style={styles.pinInfoTitle}>Managed via Web Admin</Text>
        <Text style={styles.pinInfoText}>
          Employee PINs are assigned in the web administration panel. Contact your manager to update your PIN.
        </Text>
      </View>
    </View>
  );
}

function AboutSection() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.headerIconBg}>
          <MaterialCommunityIcons name="information-outline" size={18} color={C.accent} />
        </View>
        <Text style={styles.sectionTitle}>About</Text>
      </View>
      <View style={styles.aboutCard}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App Name</Text>
          <Text style={styles.aboutValue}>CrunchNum</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>1.4.0</Text>
        </View>
          <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Platform</Text>
          <Text style={styles.aboutValue}>Android Tablet</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  content: {
    padding: 16,
    gap: 20,
    paddingBottom: 40,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  headerIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  settingLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 6,
  },
  posDeviceCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  posDeviceCardSelected: {
    borderColor: C.accent,
    backgroundColor: C.accentDim,
  },
  posDeviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  posDeviceName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.accent,
  },
  posReceiptLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textSecondary,
  },
  posDeviceDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  posDetailLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textSecondary,
  },
  posDetailValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.text,
  },
  posPairedBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: C.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  posPairedBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    color: C.textMuted,
  },
  shopRow: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.card,
    marginBottom: 4,
  },
  shopRowSelected: {
    backgroundColor: C.accentDim,
  },
  shopRowText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.text,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  manualSaveBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
  },
  manualSaveBtnDisabled: {
    opacity: 0.4,
  },
  manualSaveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#fff',
  },
  connectionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  },
  cardInfo: {
    marginBottom: 16,
  },
  statusDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  deviceName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  deviceAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  glassBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  glassBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  toast: {
    position: 'absolute',
    bottom: -10,
    left: 16,
    right: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  toastText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  emptyIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 4,
  },
  emptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  refreshHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshHintText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.accent,
  },
  pinInfoCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  pinInfoTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
    marginBottom: 4,
  },
  pinInfoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  aboutCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  aboutLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textSecondary,
  },
  aboutValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.text,
  },
  pulseContainer: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseCircle: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  staticCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  textInput: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
  },
  editRow: {
    marginBottom: 16,
  },
  editLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 8,
  },
  editInput: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: C.text,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 8,
  },
  editDropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 8,
  },
  editValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: C.text,
  },
  editHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
    marginTop: 8,
    lineHeight: 18,
  },
  inlineSearchBtn: {
    backgroundColor: C.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
  },
  inlineSearchBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#fff',
  },
  advancedLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  advancedTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  advancedSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textMuted,
  },
  toggleGroup: {
    marginTop: 10,
    gap: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.text,
  },
  toggleCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  editActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.accent,
    marginTop: 4,
  },
  editActionBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.accent,
  },
  dropdownList: {
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 6,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  dropdownItemActive: {
    backgroundColor: C.accentDim,
  },
  dropdownItemText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: C.text,
  },
});
