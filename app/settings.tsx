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
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useBluetooth } from '@/context/BluetoothContext';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

const C = Colors.dark;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { employee, shopId: contextShopId, updateShopId } = useAuth();
  const [posId, setPosId] = useState<string>('');
  const [posSaved, setPosSaved] = useState(false);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    const { listShops } = await import('@/lib/settings');
    const list = await listShops();
    setShops(list);
    setRefreshing(false);
  };

  useEffect(() => {
    if (contextShopId) setPosId(contextShopId);
    refresh();
  }, [contextShopId]);

  const handleSavePos = async (idToSave?: string) => {
    const trimmed = (idToSave ?? posId).trim();
    console.log('Settings: saving pos/shop id', trimmed);
    if (trimmed.length === 0) {
      await updateShopId(null);
      setPosId('');
    } else {
      await updateShopId(trimmed);
      setPosId(trimmed);
    }
    setPosSaved(true);
    setTimeout(() => setPosSaved(false), 2500);
  };

  const isAdmin = employee?.role?.toLowerCase() === 'admin';

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
              <MaterialCommunityIcons name="storefront-outline" size={18} color={C.accent} />
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
            <View style={styles.manualEntryRow}>
              <TextInput
                style={[styles.manualEntryInput, { flex: 1 }]}
                value={posId}
                onChangeText={setPosId}
                placeholder="e.g. POS-01"
                placeholderTextColor={C.textMuted}
              />
              <Pressable
                onPress={() => handleSavePos()}
                style={[styles.manualSaveBtn, !posId && styles.manualSaveBtnDisabled]}
                disabled={!posId.trim() && !posSaved}
              >
                <Text style={styles.manualSaveBtnText}>{posSaved ? 'Saved!' : 'Set'}</Text>
              </Pressable>
            </View>
          </View>
        )}
        <BluetoothSection />
        <PinSection />
        <AboutSection />
      </ScrollView>
    </View>
  );
}

const COMMON_PRINTERS = [
  { id: '1', name: 'Epson TM-T20III', note: 'Thermal receipt printer' },
  { id: '2', name: 'Star TSP143III', note: 'USB / Bluetooth / LAN' },
  { id: '3', name: 'Bixolon SRP-350III', note: 'Thermal POS printer' },
  { id: '4', name: 'Citizen CT-S310II', note: 'Compact receipt printer' },
  { id: '5', name: 'Xprinter XP-58', note: 'Portable Bluetooth printer' },
];

function BluetoothSection() {
  const { connectedDevice, disconnect, connect, startScan, stopScan, scannedDevices, status, testPrint } = useBluetooth();
  const [printerName, setPrinterName] = useState('');
  const [printerAddress, setPrinterAddress] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);

  const openSystemSettings = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {
        Alert.alert('Bluetooth', 'Could not open Bluetooth settings. Please open them manually.');
      });
    } else if (Platform.OS === 'ios') {
      Linking.openURL('App-Prefs:Bluetooth').catch(() => {
        Alert.alert('Bluetooth', 'Open Settings → Bluetooth to pair your printer.');
      });
    }
  };
 
  const handleTestPrint = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTesting(true);
    try {
      const success = await testPrint();
      if (success) {
        Alert.alert('Success', 'Test print sent successfully!');
      } else {
        Alert.alert('Error', 'Failed to send test print. Please check your printer connection.');
      }
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred during test print.');
    } finally {
      setTesting(false);
    }
  };

  const handleManualConnect = () => {
    if (!printerAddress.trim()) return;
    connect({
      id: printerAddress,
      name: printerName || 'Manual Printer',
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

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="bluetooth" size={18} color={C.accent} />
        <Text style={styles.sectionTitle}>Bluetooth Fiscal Printer</Text>
      </View>

      {connectedDevice ? (
        <View style={styles.connectedCard}>
          <View style={styles.connectedLeft}>
            <View style={styles.connectedIconWrap}>
              <MaterialCommunityIcons name="printer-check" size={28} color={C.success} />
            </View>
            <View>
              <Text style={styles.connectedName}>{connectedDevice.name}</Text>
              <Text style={styles.connectedAddress}>{connectedDevice.address}</Text>
              <View style={styles.connectedBadge}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedBadgeText}>Successful Connection</Text>
              </View>
            </View>
          </View>
          <View style={styles.connectedActions}>
            <Pressable onPress={handleTestPrint} style={styles.testBtn} disabled={testing}>
              {testing ? <ActivityIndicator size="small" color={C.accent} /> : <Text style={styles.testBtnText}>Test Print</Text>}
            </Pressable>
            <Pressable onPress={disconnect} style={styles.disconnectBtn}>
              <Text style={styles.disconnectBtnText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable 
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            connect({
              id: '86:67:7A:3B:87:CE',
              name: 'BT-583',
              address: '86:67:7A:3B:87:CE',
              rssi: -50
            });
          }}
          style={({ pressed }) => [
            styles.quickConnectCard,
            pressed && styles.quickConnectCardPressed
          ]}
        >
          <View style={styles.quickConnectIcon}>
            {status === 'connecting' ? (
              <ActivityIndicator color={C.accent} size="large" />
            ) : (
              <MaterialCommunityIcons name="bluetooth-connect" size={32} color={C.accent} />
            )}
          </View>
          <View style={styles.quickConnectInfo}>
            <Text style={styles.quickConnectTitle}>Standard Thermal Printer</Text>
            <Text style={styles.quickConnectSub}>Model: BT-583 (86:67:7A:3B:87:CE)</Text>
            <Text style={[
              styles.quickConnectAction,
              status === 'bluetooth_off' && { color: C.danger },
              status === 'location_off' && { color: C.warning }
            ]}>
              {status === 'connecting' ? 'Verifying Hardware...' : 
               status === 'bluetooth_off' ? 'Bluetooth Unavailable' :
               status === 'location_off' ? 'Location Required' :
               'Click to Auto-Link Printer'}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={C.accent} style={{ opacity: 0.5 }} />
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable 
          onPress={() => {
            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            status === 'scanning' ? stopScan() : startScan();
          }} 
          style={[styles.scanBtn, { flex: 1 }]}
        >
          {status === 'scanning' ? <ActivityIndicator size="small" color={C.accent} /> : <Feather name="search" size={20} color={C.accent} />}
          <Text style={styles.scanBtnText}>{status === 'scanning' ? 'Scanning...' : 'Scan for Printers'}</Text>
        </Pressable>
        <Pressable onPress={openSystemSettings} style={[styles.scanBtn, { paddingHorizontal: 16 }]}>
          <MaterialCommunityIcons name="cog-outline" size={20} color={C.accent} />
        </Pressable>
      </View>

      {status === 'bluetooth_off' && (
        <View style={styles.errorBanner}>
          <Ionicons name="bluetooth" size={16} color={C.danger} />
          <Text style={styles.errorBannerText}>Bluetooth is turned off in system settings.</Text>
          <Pressable onPress={openSystemSettings} style={styles.bannerAction}>
            <Text style={styles.bannerActionText}>Enable</Text>
          </Pressable>
        </View>
      )}

      {status === 'location_off' && (
        <View style={styles.errorBanner}>
          <Ionicons name="location" size={16} color={C.danger} />
          <Text style={styles.errorBannerText}>Location services must be enabled to scan.</Text>
          <Pressable 
            onPress={() => Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {})} 
            style={styles.bannerAction}
          >
            <Text style={styles.bannerActionText}>Enable</Text>
          </Pressable>
        </View>
      )}

      {(scannedDevices.length > 0 || status === 'scanning') && (
        <View style={styles.deviceList}>
          <Text style={styles.deviceListLabel}>Discovered Devices</Text>
          {scannedDevices.map(device => (
            <Pressable
              key={device.id}
              style={styles.deviceRow}
              onPress={() => handleSelectDevice(device)}
            >
              <View style={styles.deviceIcon}>
                <MaterialCommunityIcons name="printer-outline" size={22} color={C.accent} />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceAddress}>{device.address}</Text>
              </View>
              <View style={styles.deviceRight}>
                <Text style={styles.pairBtnText}>Connect</Text>
              </View>
            </Pressable>
          ))}
          {scannedDevices.length === 0 && status === 'scanning' && (
            <Text style={styles.emptyText}>Searching for physical printers...</Text>
          )}
        </View>
      )}

      <View style={styles.manualEntry}>
        <Text style={styles.manualEntryLabel}>Manual Connection (Fail-safe)</Text>
        <TextInput
          style={[styles.manualEntryInput, { marginBottom: 10 }]}
          value={printerName}
          onChangeText={setPrinterName}
          placeholder="Printer Name (e.g. Epson)"
          placeholderTextColor={C.textMuted}
        />
        <View style={styles.manualEntryRow}>
          <TextInput
            style={styles.manualEntryInput}
            value={printerAddress}
            onChangeText={setPrinterAddress}
            placeholder="MAC Address (e.g. 00:11:22:33:AA:BB)"
            placeholderTextColor={C.textMuted}
            autoCapitalize="characters"
          />
          <Pressable
            onPress={handleManualConnect}
            style={[styles.manualSaveBtn, !printerAddress.trim() && styles.manualSaveBtnDisabled]}
            disabled={!printerAddress.trim()}
          >
            <Text style={styles.manualSaveBtnText}>{saved ? 'Connected!' : 'Link'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function PinSection() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="lock-outline" size={18} color={C.accent} />
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
        <MaterialCommunityIcons name="information-outline" size={18} color={C.accent} />
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
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
  connectedCard: {
    backgroundColor: C.successDim,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: C.success,
  },
  connectedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  connectedIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectedName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  connectedAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.success,
  },
  connectedBadgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.success,
  },
  disconnectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.dangerDim,
    borderWidth: 1,
    borderColor: C.danger,
  },
  disconnectBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.danger,
  },
  connectedActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  testBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.accentDim,
    borderWidth: 1,
    borderColor: C.accent,
  },
  testBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.accentLight,
  },
  notConnectedCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  notConnectedText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: C.textSecondary,
  },
  notConnectedSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textMuted,
  },
  scanBtn: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.accent,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  scanBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.accent,
  },
  manualEntry: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  manualEntryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  manualEntryRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  manualEntryInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
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
  deviceList: {
    gap: 8,
  },
  deviceListLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  deviceRow: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.text,
  },
  deviceAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 2,
  },
  deviceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pairBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.accentDim,
    borderWidth: 1,
    borderColor: C.accent,
  },
  pairBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.accentLight,
  },
  connectedSmallBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: C.successDim,
  },
  connectedSmallText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.success,
  },
  quickConnectCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: 'dashed',
  },
  quickConnectCardPressed: {
    backgroundColor: C.surface,
    borderColor: C.accent,
    transform: [{ scale: 0.98 }],
  },
  quickConnectIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.accent,
  },
  quickConnectInfo: {
    flex: 1,
    gap: 2,
  },
  quickConnectTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.text,
  },
  quickConnectSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
  },
  quickConnectAction: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.accent,
    marginTop: 4,
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
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.dangerDim,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.danger,
    gap: 8,
    marginTop: 10,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.danger,
  },
  bannerAction: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: C.danger,
    borderRadius: 6,
  },
  bannerActionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#fff',
  },
});
