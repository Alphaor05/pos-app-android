import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSpring,
  Easing 
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { SaleRecord, getAllSales, deleteSaleFromQueue } from '@/lib/offlineDb';
import { syncSalesQueue, syncSingleSale } from '@/lib/sync';
import { useAuth } from '@/context/AuthContext';

const C = Colors.dark;

export default function SalesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { employee } = useAuth();
  const isAdmin = employee?.role === 'Admin';

  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retryResults, setRetryResults] = useState<Record<string, { success: boolean; msg?: string }>>({});

  const rotation = useSharedValue(0);
  const btnScale = useSharedValue(1);

  useEffect(() => {
    if (isSyncing || refreshing) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = withTiming(0);
    }
  }, [isSyncing, refreshing]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const load = useCallback(async () => {
    const list = await getAllSales();
    setSales(list);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await syncSalesQueue();
    await load();
    setRefreshing(false);
  };

  const handleManualSync = async () => {
    if (isSyncing) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    setIsSyncing(true);
    try {
        await syncSalesQueue();
        await load();
    } finally {
        // Artifical delay for animation smoothness
        setTimeout(() => setIsSyncing(false), 600);
    }
  };

  const handleRetry = async (saleId: string) => {
    if (retryingIds.has(saleId)) return;
    
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    setRetryingIds(prev => new Set(prev).add(saleId));
    setRetryResults(prev => {
      const next = { ...prev };
      delete next[saleId];
      return next;
    });

    try {
      const result = await syncSingleSale(saleId);
      
      if (result.success) {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRetryResults(prev => ({ ...prev, [saleId]: { success: true } }));
        // Reload after a short delay so they can see the success indicator
        setTimeout(load, 2000);
      } else {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setRetryResults(prev => ({ ...prev, [saleId]: { success: false, msg: result.error || 'Retry failed' } }));
      }
    } catch (e) {
      setRetryResults(prev => ({ ...prev, [saleId]: { success: false, msg: String(e) } }));
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(saleId);
        return next;
      });
      // Clear result message after a few seconds if it was an error
      setTimeout(() => {
        setRetryResults(prev => {
          if (prev[saleId]?.success) return prev; // Keep success
          const next = { ...prev };
          delete next[saleId];
          return next;
        });
      }, 5000);
    }
  };

  const handleDeleteSale = async (id: string) => {
    Alert.alert(
      'Delete Sale',
      'Are you sure you want to remove this sale from the local queue? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
             try {
                await deleteSaleFromQueue(id);
                load();
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
             } catch (e) {
                Alert.alert('Error', 'Failed to delete sale');
             }
          }
        }
      ]
    );
  };

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = ({ item }: { item: SaleRecord }) => {
    const date = new Date(item.created_at);
    const dateStr = date.toLocaleString();
    const isHealed = item.synced && (item.sync_attempts || 0) > 1;
    const isFailed = !item.synced && (item.sync_attempts || 0) > 0;
    
    const isRetrying = retryingIds.has(item.id);
    const result = retryResults[item.id];

    return (
      <View style={styles.rowContainer}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowId}>{item.id.slice(0, 8)} - ${item.data?.total || '0'}</Text>
            <Text style={styles.rowDate}>{dateStr}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {isFailed && !item.synced && (
                <Pressable 
                  onPress={() => handleRetry(item.id)}
                  disabled={isRetrying}
                  style={({ pressed }) => [
                    styles.retryBadge,
                    pressed && { opacity: 0.7 },
                    isRetrying && { opacity: 0.5 }
                  ]}
                >
                  {isRetrying ? (
                    <ActivityIndicator size="small" color={C.warning} />
                  ) : result?.success ? (
                    <Ionicons name="checkmark-circle" size={16} color={C.success} />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={14} color={C.warning} />
                      <Text style={styles.retryText}>Retry</Text>
                    </>
                  )}
                </Pressable>
              )}
              {isAdmin && !item.synced && (
                <Pressable 
                  onPress={() => handleDeleteSale(item.id)}
                  style={({ pressed }) => [
                    styles.deleteBadge,
                    pressed && { opacity: 0.7 }
                  ]}
                >
                  <Ionicons name="trash-outline" size={14} color={C.error} />
                </Pressable>
              )}
              <Text style={[
                styles.rowStatus, 
                item.synced ? (isHealed ? styles.healed : styles.synced) : (isFailed ? styles.failed : styles.pending)
              ]}>
                {item.synced ? (isHealed ? 'Self-Healed' : 'Synced') : (isFailed ? 'Failed' : 'Pending')}
              </Text>
            </View>
            {isAdmin && (item.sync_attempts || 0) > 0 && (
              <Text style={styles.attemptsText}>Try #{item.sync_attempts}</Text>
            )}
          </View>
        </View>
        
        {result && !result.success && (
          <View style={styles.retryFeedbackBox}>
            <Text style={styles.retryFeedbackText}>{result.msg}</Text>
          </View>
        )}

        {isAdmin && !item.synced && (item as any).last_error && !result && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText} numberOfLines={2}>
              {(item as any).last_error}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sales Queue</Text>
        <Animated.View style={animatedBtnStyle}>
          <Pressable 
            onPress={handleManualSync} 
            onPressIn={() => { btnScale.value = withSpring(0.9); }}
            onPressOut={() => { btnScale.value = withSpring(1); }}
            style={styles.syncBtn}
            disabled={isSyncing}
          >
            <Animated.View style={animatedIconStyle}>
              <Ionicons name="refresh" size={20} color={(isSyncing || refreshing) ? C.accent : C.textSecondary} />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>

      <FlatList
        data={sales}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accent}
            colors={[C.accent]}
          />
        }
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.empty}>No local sales</Text>}
      />
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
  syncBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowId: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.text,
  },
  rowDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textSecondary,
  },
  rowStatus: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  synced: {
    backgroundColor: C.successDim,
    color: C.success,
  },
  pending: {
    backgroundColor: C.card,
    color: C.textMuted,
  },
  failed: {
    backgroundColor: C.warningDim,
    color: C.warning,
  },
  healed: {
    backgroundColor: C.accentDim,
    color: C.accentLight,
  },
  rowContainer: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 4,
  },
  attemptsText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  errorText: {
    color: C.danger,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  retryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.2)',
  },
  retryText: {
    color: C.warning,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 4,
  },
  retryFeedbackBox: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: -4,
    marginBottom: 8,
  },
  retryFeedbackText: {
    color: C.warning,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  deleteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    marginRight: 6,
  },
  empty: {
    padding: 20,
    textAlign: 'center',
    color: C.textSecondary,
  },
});

