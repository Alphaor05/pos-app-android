import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/colors';

const C = Colors.dark;
const PIN_LENGTH = 4;

const NUMPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

function PinDot({ filled, index }: { filled: boolean; index: number }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (filled) {
      scale.value = withSpring(1.3, { damping: 8 }, () => {
        scale.value = withSpring(1);
      });
    }
  }, [filled]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      <View
        style={[
          styles.dot,
          filled ? styles.dotFilled : styles.dotEmpty,
        ]}
      />
    </Animated.View>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const shakeX = useSharedValue(0);

  const shake = () => {
    shakeX.value = withSequence(
      withTiming(-12, { duration: 60, easing: Easing.inOut(Easing.ease) }),
      withTiming(12, { duration: 60, easing: Easing.inOut(Easing.ease) }),
      withTiming(-8, { duration: 60, easing: Easing.inOut(Easing.ease) }),
      withTiming(8, { duration: 60, easing: Easing.inOut(Easing.ease) }),
      withTiming(-4, { duration: 60, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: 60, easing: Easing.inOut(Easing.ease) }),
    );
  };

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const handlePress = async (key: string) => {
    if (key === 'del') {
      setError(false);
      setPin(prev => prev.slice(0, -1));
      return;
    }
    if (key === '') return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const newPin = pin + key;
    setPin(newPin);
    setError(false);

    if (newPin.length === PIN_LENGTH) {
      const success = await login(newPin);
      if (!success) {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        shake();
        setError(true);
        setTimeout(() => {
          setPin('');
          setError(false);
        }, 800);
      }
    }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: topPad, paddingBottom: botPad },
      ]}
    >
      <View style={styles.logoArea}>
        <View style={styles.logoCircle}>
          <MaterialCommunityIcons name="point-of-sale" size={36} color={C.accent} />
        </View>
        <Text style={styles.appTitle}>POS Terminal</Text>
        <Text style={styles.appSubtitle}>Enter your PIN to continue</Text>
      </View>

      <Animated.View style={[styles.pinRow, shakeStyle]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <PinDot key={i} filled={i < pin.length} index={i} />
        ))}
      </Animated.View>

      {error && (
        <Text style={styles.errorText}>Incorrect PIN. Try again.</Text>
      )}
      {!error && <View style={{ height: 20 }} />}

      <View style={styles.numpad}>
        {NUMPAD.map((row, ri) => (
          <View key={ri} style={styles.numpadRow}>
            {row.map((key, ki) => (
              <NumKey key={ki} value={key} onPress={handlePress} />
            ))}
          </View>
        ))}
      </View>

    </View>
  );
}

function NumKey({ value, onPress }: { value: string; onPress: (k: string) => void }) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (value === '') return <View style={styles.numKey} />;

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.88, { damping: 8 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 8 });
      }}
      onPress={() => onPress(value)}
    >
      <Animated.View style={[styles.numKey, styles.numKeyActive, animStyle]}>
        {value === 'del' ? (
          <MaterialCommunityIcons name="backspace-outline" size={24} color={C.text} />
        ) : (
          <Text style={styles.numKeyText}>{value}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  logoArea: {
    alignItems: 'center',
    gap: 8,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: C.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.accent,
  },
  appTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: C.textSecondary,
  },
  pinRow: {
    flexDirection: 'row',
    gap: 20,
    marginVertical: 8,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dotEmpty: {
    borderWidth: 2,
    borderColor: C.border,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: C.accent,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: Colors.dark.danger,
    height: 20,
  },
  numpad: {
    gap: 12,
  },
  numpadRow: {
    flexDirection: 'row',
    gap: 12,
  },
  numKey: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numKeyActive: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  numKeyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 26,
    color: C.text,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
    marginTop: 8,
  },
});
