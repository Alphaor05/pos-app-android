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

  const [posId, setPosId] = useState<string>('');
  const [posSaved, setPosSaved] = useState(false);
  const [shops, setShops] = useState<Array<{ id: string; name: string }>>([]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    const { listShops } = await import('@/lib/settings');
    const list = await listShops();
    setShops(list);
    setRefreshing(false);
  };

  useEffect(() => {
    (async () => {
      const { getPosId } = await import('@/lib/settings');
      const id = await getPosId();
      if (id) setPosId(id);
      refresh();
    })();
  }, []);

  const handleSavePos = async (idToSave?: string) => {
    const trimmed = (idToSave ?? posId).trim();
    console.log('Settings: saving pos/shop id', trimmed);
    const { setPosId } = await import('@/lib/settings');
    if (trimmed.length === 0) {
      await setPosId(null);
      setPosId('');
    } else {
      await setPosId(trimmed);
      setPosId(trimmed);
    }
    setPosSaved(true);
    setTimeout(() => setPosSaved(false), 2500);
  };

  const { employee } = useAuth();
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
  const { connectedDevice, disconnect, connect } = useBluetooth();
  const [printerName, setPrinterName] = useState('');
  const [saved, setSaved] = useState(false);

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
    } else {
      Alert.alert('Bluetooth Settings', 'Open your device Bluetooth settings to pair your printer, then enter its name below.');
    }
  };

  const handleSavePrinter = () => {
    const name = printerName.trim();
    if (!name) return;
    connect({ id: name, name, address: 'Manual', rssi: -60 });
    setSaved(true);
    setPrinterName('');
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleDisconnect = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    disconnect();
  };

  const handleSelectModel = (name: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPrinterName(name);
    openSystemSettings();
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
                <Text style={styles.connectedBadgeText}>Active</Text>
              </View>
            </View>
          </View>
          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Text style={styles.disconnectBtnText}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.notConnectedCard}>
          <MaterialCommunityIcons name="printer-off" size={32} color={C.textMuted} />
          <Text style={styles.notConnectedText}>No printer configured</Text>
          <Text style={styles.notConnectedSub}>Pair via Android Bluetooth settings, then add the name below</Text>
        </View>
      )}

      <Pressable onPress={openSystemSettings} style={styles.scanBtn}>
        <MaterialCommunityIcons name="bluetooth-settings" size={20} color={C.accent} />
        <Text style={styles.scanBtnText}>Open Bluetooth Settings</Text>
      </Pressable>

      <View style={styles.manualEntry}>
        <Text style={styles.manualEntryLabel}>Printer Name (after pairing)</Text>
        <View style={styles.manualEntryRow}>
          <TextInput
            style={styles.manualEntryInput}
            value={printerName}
            onChangeText={setPrinterName}
            placeholder="e.g. Epson TM-T20III"
            placeholderTextColor={C.textMuted}
          />
          <Pressable
            onPress={handleSavePrinter}
            style={[styles.manualSaveBtn, !printerName.trim() && styles.manualSaveBtnDisabled]}
            disabled={!printerName.trim()}
          >
            <Text style={styles.manualSaveBtnText}>{saved ? 'Saved!' : 'Set'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.deviceList}>
        <Text style={styles.deviceListLabel}>Common Fiscal Printers</Text>
        {COMMON_PRINTERS.map(printer => (
          <Pressable
            key={printer.id}
            style={styles.deviceRow}
            onPress={() => handleSelectModel(printer.name)}
          >
            <View style={styles.deviceIcon}>
              <MaterialCommunityIcons name="printer-outline" size={22} color={C.textSecondary} />
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{printer.name}</Text>
              <Text style={styles.deviceAddress}>{printer.note}</Text>
            </View>
            <View style={styles.deviceRight}>
              <Feather name="external-link" size={14} color={C.textMuted} />
              <Text style={styles.pairBtnText}>Pair</Text>
            </View>
          </Pressable>
        ))}
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
          <Text style={styles.aboutValue}>POS Terminal</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>1.0.0</Text>
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
});
