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
        <BluetoothSection />
        <ReceiptDesignSection />
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

function BluetoothSection() {
  const { 
    connectedDevice, 
    disconnect, 
    connect,
    pairedDevices, 
    status, 
    testPrint, 
    refreshPairedDevices,
    enableBluetooth,
    openSettings
  } = useBluetooth();
  
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
        setTestMessage('✓ Test print successful!');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => setTestMessage(''), 3000);
      } else {
        setTestMessage('✗ Print failed - check connection');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => setTestMessage(''), 4000);
      }
    } catch (err) {
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
      case 'scanning': return 'Scanning...';
      default: return 'Disconnected';
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
          end={{ x: 1, y: 1 }}
          style={styles.premiumCard}
        >
          <View style={styles.cardTop}>
            <View style={styles.printerIconWrapper}>
              {status === 'connecting' ? (
                <PulsingIndicator color={C.accent} />
              ) : (
                <MaterialCommunityIcons 
                  name="printer-check" 
                  size={32} 
                  color={status === 'connected' ? C.success : C.textMuted} 
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.connectedName}>{connectedDevice.name}</Text>
              <Text style={styles.connectedAddress}>{connectedDevice.address}</Text>
              <View style={styles.statusBadgeRow}>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20' }]}>
                  <Text style={[styles.statusBadgeText, { color: getStatusColor() }]}>
                    {getStatusMessage().toUpperCase()}
                  </Text>
                </View>
                {status === 'connected' && (
                  <View style={[styles.statusBadge, { backgroundColor: C.success + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: C.success }]}>VERIFIED</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          <View style={styles.premiumActionRow}>
            <Pressable 
              onPress={handleTestPrint} 
              style={({ pressed }) => [
                styles.glassBtn,
                pressed && { opacity: 0.7 },
                (testing || status !== 'connected') && styles.btnDisabled
              ]}
              disabled={testing || status !== 'connected'}
            >
              {testing ? (
                <ActivityIndicator size="small" color={C.accent} />
              ) : (
                <>
                  <MaterialCommunityIcons name="printer-eye" size={18} color={C.accent} />
                  <Text style={styles.glassBtnText}>Test Print</Text>
                </>
              )}
            </Pressable>

            <Pressable 
              onPress={disconnect}
              style={({ pressed }) => [
                styles.glassBtn,
                pressed && { opacity: 0.7 },
                { borderColor: C.danger + '40' }
              ]}
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
      ) : (
        <Pressable 
          onPress={refreshPairedDevices}
          style={({ pressed }) => [styles.emptyStateCard, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.emptyIconBg}>
            <MaterialCommunityIcons name="bluetooth-connect" size={40} color={C.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Ready to Connect</Text>
          <Text style={styles.emptySub}>No printer linked yet. Select one from the list below to start printing receipts.</Text>
          <View style={styles.refreshHint}>
            <MaterialCommunityIcons name="sync" size={14} color={C.accent} />
            <Text style={styles.refreshHintText}>Tap to refresh paired list</Text>
          </View>
        </Pressable>
      )}

      <View style={styles.modernControlRow}>
        <LinearGradient
          colors={[C.accent, C.accent + 'CC']}
          style={styles.refreshBtnGradient}
        >
          <Pressable 
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              refreshPairedDevices();
            }} 
            style={styles.refreshBtnInner}
          >
            {status === 'scanning' ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="refresh" size={20} color="#FFF" />
                <Text style={styles.refreshBtnText}>REFRESH DEVICES</Text>
              </>
            )}
          </Pressable>
        </LinearGradient>

        <Pressable onPress={openSystemSettings} style={styles.settingsIconBtn}>
          <MaterialCommunityIcons name="cog-outline" size={22} color={C.accent} />
        </Pressable>
      </View>

      <View style={styles.deviceListContainer}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>PAIRED DEVICES</Text>
          <View style={styles.listLine} />
        </View>

        {pairedDevices.length > 0 ? (
          pairedDevices.map(device => {
            const isSelected = connectedDevice?.address === device.address;
            return (
              <Pressable
                key={device.id}
                style={({ pressed }) => [
                  styles.modernDeviceCard,
                  isSelected && styles.deviceCardActive,
                  pressed && { transform: [{ scale: 0.98 }] }
                ]}
                onPress={() => handleSelectDevice(device)}
              >
                <View style={[styles.deviceTypeIcon, isSelected && { backgroundColor: C.success + '20' }]}>
                  <MaterialCommunityIcons 
                    name={isSelected ? "check-circle" : "printer"} 
                    size={22} 
                    color={isSelected ? C.success : C.accent} 
                  />
                </View>
                <View style={styles.deviceContent}>
                  <Text style={[styles.deviceNameMain, isSelected && { color: C.success }]}>
                    {device.name}
                  </Text>
                  <Text style={styles.deviceAddressSub}>{device.address}</Text>
                </View>
                {isSelected ? (
                  <View style={styles.activeTag}>
                    <Text style={styles.activeTagText}>ACTIVE</Text>
                  </View>
                ) : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={C.textMuted} />
                )}
              </Pressable>
            );
          })
        ) : (
          <View style={styles.emptyListState}>
            <MaterialCommunityIcons name="bluetooth-off" size={48} color={C.border} />
            <Text style={styles.emptyListText}>No bonded printers found</Text>
            <Pressable onPress={openSystemSettings} style={styles.pairLink}>
              <Text style={styles.pairLinkText}>Open Settings to Pair Printer</Text>
              <MaterialCommunityIcons name="open-in-new" size={14} color={C.accent} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.manualSection}>
        <Text style={styles.manualLabel}>Manual Connection</Text>
        <TextInput
          style={[styles.textInput, { marginBottom: 8 }]}
          value={printerName}
          onChangeText={setPrinterName}
          placeholder="Printer name (optional)"
          placeholderTextColor={C.textMuted}
        />
        <View style={styles.manualRow}>
          <TextInput
            style={[styles.textInput, { flex: 1, marginRight: 8 }]}
            value={printerAddress}
            onChangeText={setPrinterAddress}
            placeholder="MAC address"
            placeholderTextColor={C.textMuted}
            autoCapitalize="characters"
          />
          <Pressable
            onPress={handleManualConnect}
            style={[
              styles.linkBtn,
              !printerAddress.trim() && styles.linkBtnDisabled
            ]}
            disabled={!printerAddress.trim()}
          >
            <Text style={styles.linkBtnText}>{saved ? '✓' : 'Link'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ReceiptDesignSection() {
  const { shopId } = useAuth();
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [receiptSize, setReceiptSize] = useState<'58mm' | '80mm'>('58mm');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { getReceiptDesign } = await import('@/lib/offlineDb');
        const design = await getReceiptDesign(shopId);
        if (design) {
          setHeader(design.header || '');
          setFooter(design.footer || '');
          setReceiptSize((design.receipt_size as '58mm' | '80mm') || '58mm');
        }
      } catch (e) {
        console.warn('[ReceiptDesign] load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [shopId]);

  const handleSave = async () => {
    if (Platform.OS === 'web') return;
    try {
      const { saveReceiptDesign } = await import('@/lib/offlineDb');
      await saveReceiptDesign({
        id: shopId || 'default',
        shop_id: shopId || null,
        header: header.trim() || null,
        footer: footer.trim() || null,
        receipt_size: receiptSize,
      });
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      Alert.alert('Error', 'Could not save receipt design.');
    }
  };

  if (loading) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.headerIconBg}>
          <MaterialCommunityIcons name="receipt" size={18} color={C.accent} />
        </View>
        <Text style={styles.sectionTitle}>Receipt Design</Text>
      </View>

      <Text style={styles.settingLabel}>Header (printed at the top)</Text>
      <TextInput
        style={styles.designInput}
        value={header}
        onChangeText={setHeader}
        placeholder={'e.g. MY STORE\nThank you for visiting!'}
        placeholderTextColor={C.textMuted}
        multiline
        numberOfLines={3}
      />

      <Text style={[styles.settingLabel, { marginTop: 10 }]}>Footer (printed at the bottom)</Text>
      <TextInput
        style={styles.designInput}
        value={footer}
        onChangeText={setFooter}
        placeholder={'e.g. All sales are final.\nHave a great day!'}
        placeholderTextColor={C.textMuted}
        multiline
        numberOfLines={3}
      />

      <Text style={[styles.settingLabel, { marginTop: 10 }]}>Paper Size</Text>
      <View style={styles.sizeSelector}>
        {(['58mm', '80mm'] as const).map(size => (
          <Pressable
            key={size}
            style={[styles.sizeOption, receiptSize === size && styles.sizeOptionActive]}
            onPress={() => setReceiptSize(size)}
          >
            <MaterialCommunityIcons
              name="printer"
              size={16}
              color={receiptSize === size ? C.accent : C.textMuted}
            />
            <Text style={[styles.sizeOptionText, receiptSize === size && { color: C.accent }]}>
              {size}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.manualSaveBtn, { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 24 }]}
        onPress={handleSave}
      >
        <Text style={styles.manualSaveBtnText}>{saved ? '✓ Saved!' : 'Save Design'}</Text>
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
  premiumCard: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  printerIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  connectedName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
    marginBottom: 2,
  },
  connectedAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 8,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  premiumActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  glassBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  glassBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  toast: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  toastText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  emptyStateCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: C.border,
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
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
  modernControlRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  refreshBtnGradient: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  refreshBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  refreshBtnText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    color: '#FFF',
    letterSpacing: 0.5,
  },
  settingsIconBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceListContainer: {
    marginBottom: 32,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  listTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1.5,
  },
  listLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
    opacity: 0.5,
  },
  modernDeviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  deviceCardActive: {
    borderColor: C.success + '40',
    backgroundColor: C.success + '05',
  },
  deviceTypeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  deviceContent: {
    flex: 1,
  },
  deviceNameMain: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
    marginBottom: 2,
  },
  deviceAddressSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.textMuted,
  },
  activeTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: C.success,
  },
  activeTagText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 9,
    color: '#FFF',
  },
  emptyListState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyListText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.textMuted,
  },
  pairLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  pairLinkText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.accent,
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
  manualSection: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  manualLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
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
  linkBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 50,
  },
  linkBtnDisabled: {
    opacity: 0.5,
  },
  linkBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#fff',
  },
  designInput: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    textAlignVertical: 'top',
    minHeight: 70,
  },
  sizeSelector: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  sizeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  sizeOptionActive: {
    borderColor: C.accent,
    backgroundColor: C.accentDim,
  },
  sizeOptionText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.textMuted,
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
});
