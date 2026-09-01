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
import { SaleRecord, getAllSales, deleteSaleFromQueue, countCorruptSales, deleteCorruptSales, exportSalesQueue } from '@/lib/offlineDb';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { syncSalesQueue, syncSingleSale, retryBlockedSales, MAX_ATTEMPTS } from '@/lib/sync';
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
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [corruptCount, setCorruptCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [clearingCorrupt, setClearingCorrupt] = useState(false);

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
  }, [isSyncing, refreshing, rotation]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const load = useCallback(async () => {
    const list = await getAllSales();
    setSales(list);
    const corrupt = await countCorruptSales();
    setCorruptCount(corrupt);
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
             } catch {
                Alert.alert('Error', 'Failed to delete sale');
             }
          }
        }
      ]
    );
  };

  const handleRetryBlocked = async () => {
    if (bulkRetrying) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBulkRetrying(true);
    try {
      const result = await retryBlockedSales();
      await load();
      if (result.attempted > 0) {
        if (result.synced > 0 && Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        Alert.alert(
          'Retry Blocked',
          `Attempted ${result.attempted} sale(s).\n${result.synced} synced, ${result.failed} still failing.`,
          [{ text: 'OK' }]
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to retry blocked sales');
    } finally {
      setBulkRetrying(false);
    }
  };

  const handleExportQueue = async () => {
    if (exporting) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExporting(true);
    try {
      const json = await exportSalesQueue();
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pos-queue-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, `pos-queue-${new Date().toISOString().slice(0, 10)}.json`);
        file.write(json);
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export Sales Queue',
        });
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Export Failed', 'Could not export the sales queue.');
    } finally {
      setExporting(false);
    }
  };

  const handleClearCorrupt = async () => {
    if (clearingCorrupt) return;
    Alert.alert(
      'Clear Corrupt Records',
      'These records are unreadable and will never sync. Removing them keeps the queue clean. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setClearingCorrupt(true);
            try {
              const removed = await deleteCorruptSales();
              await load();
              if (removed > 0 && Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch {
              Alert.alert('Error', 'Failed to clear corrupt records');
            } finally {
              setClearingCorrupt(false);
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
    const attempts = item.sync_attempts || 0;
    const isBlocked = !item.synced && attempts >= MAX_ATTEMPTS;
    
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
                  <Ionicons name="trash-outline" size={14} color={C.danger} />
                </Pressable>
              )}
              <Text style={[
                styles.rowStatus, 
                item.synced ? (isHealed ? styles.healed : styles.synced) : (isBlocked ? styles.blocked : (isFailed ? styles.failed : styles.pending))
              ]}>
                {item.synced ? (isHealed ? 'Self-Healed' : 'Synced') : (isBlocked ? 'Blocked' : (isFailed ? 'Failed' : 'Pending'))}
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

  const blockedCount = sales.filter(s => !s.synced && (s.sync_attempts || 0) >= MAX_ATTEMPTS).length;

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sales Queue</Text>
        <View style={styles.headerActions}>
          {isAdmin && (
            <Pressable
              onPress={handleExportQueue}
              disabled={exporting}
              style={styles.syncBtn}
            >
              <Ionicons name="share-outline" size={20} color={exporting ? C.accent : C.textSecondary} />
            </Pressable>
          )}
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
      </View>

      {corruptCount > 0 && (
        <View style={styles.corruptBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={C.warning} />
          <Text style={styles.corruptText}>
            {corruptCount} unreadable sale record(s) detected on this device.
          </Text>
          {isAdmin && (
            <Pressable
              onPress={handleClearCorrupt}
              disabled={clearingCorrupt}
              style={styles.corruptClearBtn}
            >
              {clearingCorrupt ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.corruptClearText}>Clear</Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {blockedCount > 0 && (
        <Pressable
          onPress={handleRetryBlocked}
          disabled={bulkRetrying}
          style={[styles.blockedBanner, bulkRetrying && { opacity: 0.6 }]}
        >
          {bulkRetrying ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="refresh" size={16} color="#fff" />
          )}
          <Text style={styles.blockedBannerText}>
            {bulkRetrying ? 'Retrying blocked sales...' : `Retry Blocked (${blockedCount})`}
          </Text>
        </Pressable>
      )}

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corruptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: C.warningDim,
    borderWidth: 1,
    borderColor: C.warning + '40',
  },
  corruptText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.warning,
  },
  corruptClearBtn: {
    backgroundColor: C.danger,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corruptClearText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#fff',
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.danger,
  },
  blockedBannerText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#fff',
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
  blocked: {
    backgroundColor: C.dangerDim,
    color: C.danger,
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

