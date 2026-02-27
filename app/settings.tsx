import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  withSpring,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useBluetooth, BluetoothDevice } from '@/context/BluetoothContext';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

const C = Colors.dark;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

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
      >
        <BluetoothSection />
        <PinSection />
        <AboutSection />
      </ScrollView>
    </View>
  );
}

function BluetoothSection() {
  const {
    connectedDevice,
    status,
    scannedDevices,
    startScan,
    stopScan,
    connect,
    disconnect,
  } = useBluetooth();

  const pulse = useSharedValue(1);

  React.useEffect(() => {
    if (status === 'scanning') {
      pulse.value = withRepeat(
        withTiming(1.15, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulse.value = withSpring(1);
    }
  }, [status]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: status === 'scanning' ? 0.9 : 1,
  }));

  const handleScan = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (status === 'scanning') {
      stopScan();
    } else {
      startScan();
    }
  };

  const handleConnect = async (device: BluetoothDevice) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await connect(device);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDisconnect = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    disconnect();
  };

  const isConnecting = status === 'connecting';

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
                <Text style={styles.connectedBadgeText}>Connected</Text>
              </View>
            </View>
          </View>
          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Text style={styles.disconnectBtnText}>Disconnect</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.notConnectedCard}>
          <MaterialCommunityIcons name="printer-off" size={32} color={C.textMuted} />
          <Text style={styles.notConnectedText}>No printer connected</Text>
          <Text style={styles.notConnectedSub}>Scan to find nearby devices</Text>
        </View>
      )}

      <Pressable
        onPress={handleScan}
        style={[styles.scanBtn, status === 'scanning' && styles.scanBtnActive]}
        disabled={isConnecting}
      >
        <Animated.View style={[styles.scanBtnInner, pulseStyle]}>
          <MaterialCommunityIcons
            name={status === 'scanning' ? 'bluetooth-audio' : 'bluetooth-search'}
            size={20}
            color={status === 'scanning' ? C.text : C.accent}
          />
          <Text style={[styles.scanBtnText, status === 'scanning' && styles.scanBtnTextActive]}>
            {status === 'scanning' ? 'Scanning...' : 'Scan for Devices'}
          </Text>
        </Animated.View>
      </Pressable>

      {isConnecting && (
        <View style={styles.connectingRow}>
          <MaterialCommunityIcons name="loading" size={16} color={C.accent} />
          <Text style={styles.connectingText}>Connecting to printer...</Text>
        </View>
      )}

      {scannedDevices.length > 0 && (
        <View style={styles.deviceList}>
          <Text style={styles.deviceListLabel}>Nearby Devices</Text>
          {scannedDevices.map((device, idx) => (
            <DeviceRow
              key={device.id}
              device={device}
              isConnected={connectedDevice?.id === device.id}
              onConnect={() => handleConnect(device)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function DeviceRow({
  device,
  isConnected,
  onConnect,
}: {
  device: BluetoothDevice;
  isConnected: boolean;
  onConnect: () => void;
}) {
  const rssiStrength = device.rssi > -60 ? 'strong' : device.rssi > -70 ? 'medium' : 'weak';
  const rssiIcon = rssiStrength === 'strong' ? 'wifi' : rssiStrength === 'medium' ? 'wifi' : 'wifi-off';
  const rssiColor = rssiStrength === 'strong' ? C.success : rssiStrength === 'medium' ? C.warning : C.textMuted;

  return (
    <View style={styles.deviceRow}>
      <View style={styles.deviceIcon}>
        <MaterialCommunityIcons name="printer-outline" size={22} color={C.textSecondary} />
      </View>
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceAddress}>{device.address}</Text>
      </View>
      <View style={styles.deviceRight}>
        <Feather name={rssiIcon as any} size={14} color={rssiColor} />
        {isConnected ? (
          <View style={styles.connectedSmallBadge}>
            <Text style={styles.connectedSmallText}>Connected</Text>
          </View>
        ) : (
          <Pressable onPress={onConnect} style={styles.pairBtn}>
            <Text style={styles.pairBtnText}>Pair</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PinSection() {
  const { pin, changePin } = useAuth();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleChangePin = async () => {
    if (currentPin !== pin) {
      setMessage({ type: 'error', text: 'Current PIN is incorrect' });
      return;
    }
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setMessage({ type: 'error', text: 'New PIN must be 4 digits' });
      return;
    }
    if (newPin !== confirmPin) {
      setMessage({ type: 'error', text: 'PINs do not match' });
      return;
    }
    await changePin(newPin);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setMessage({ type: 'success', text: 'PIN changed successfully' });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MaterialCommunityIcons name="lock-outline" size={18} color={C.accent} />
        <Text style={styles.sectionTitle}>Change PIN</Text>
      </View>

      <View style={styles.pinForm}>
        <PinInput
          label="Current PIN"
          value={currentPin}
          onChangeText={setCurrentPin}
        />
        <PinInput
          label="New PIN"
          value={newPin}
          onChangeText={setNewPin}
        />
        <PinInput
          label="Confirm New PIN"
          value={confirmPin}
          onChangeText={setConfirmPin}
        />

        {message && (
          <Text style={[
            styles.formMessage,
            message.type === 'success' ? styles.formMessageSuccess : styles.formMessageError,
          ]}>
            {message.text}
          </Text>
        )}

        <Pressable
          onPress={handleChangePin}
          style={styles.changePinBtn}
        >
          <Text style={styles.changePinBtnText}>Update PIN</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PinInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.pinInputWrap}>
      <Text style={styles.pinInputLabel}>{label}</Text>
      <TextInput
        style={styles.pinInputField}
        value={value}
        onChangeText={v => {
          if (/^\d{0,4}$/.test(v)) onChangeText(v);
        }}
        keyboardType="numeric"
        maxLength={4}
        secureTextEntry
        placeholderTextColor={C.textMuted}
        placeholder="••••"
      />
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
    alignItems: 'center',
  },
  scanBtnActive: {
    backgroundColor: C.accentDim,
    borderColor: C.accentLight,
  },
  scanBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.accent,
  },
  scanBtnTextActive: {
    color: C.text,
  },
  connectingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  connectingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.accent,
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
  pinForm: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  pinInputWrap: {
    gap: 6,
  },
  pinInputLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  pinInputField: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    letterSpacing: 6,
  },
  formMessage: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  formMessageSuccess: {
    backgroundColor: C.successDim,
    color: C.success,
  },
  formMessageError: {
    backgroundColor: C.dangerDim,
    color: C.danger,
  },
  changePinBtn: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  changePinBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#fff',
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
});
