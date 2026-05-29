import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { SaleRecord, getAllSales } from '@/lib/offlineDb';
import { syncSalesQueue } from '@/lib/sync';
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

  const load = async () => {
    const list = await getAllSales();
    setSales(list);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await syncSalesQueue();
    await load();
    setRefreshing(false);
  };

  useEffect(() => {
    load();
  }, []);

  const renderItem = ({ item }: { item: SaleRecord }) => {
    const date = new Date(item.created_at);
    const dateStr = date.toLocaleString();
    const isHealed = item.synced && (item.sync_attempts || 0) > 1;
    const isFailed = !item.synced && (item.sync_attempts || 0) > 0;

    return (
      <View style={styles.rowContainer}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowId}>{item.id.slice(0, 8)} - ${item.data?.total || '0'}</Text>
            <Text style={styles.rowDate}>{dateStr}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[
              styles.rowStatus, 
              item.synced ? (isHealed ? styles.healed : styles.synced) : (isFailed ? styles.failed : styles.pending)
            ]}>
              {item.synced ? (isHealed ? 'Self-Healed' : 'Synced') : (isFailed ? 'Retrying...' : 'Pending')}
            </Text>
            {isAdmin && (item.sync_attempts || 0) > 0 && (
              <Text style={styles.attemptsText}>Try #{item.sync_attempts}</Text>
            )}
          </View>
        </View>
        
        {isAdmin && !item.synced && (item as any).last_error && (
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
        <Pressable onPress={() => syncSalesQueue().then(load)} style={styles.syncBtn}>
          <Ionicons name="refresh" size={20} color={C.accent} />
        </Pressable>
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
    borderBottomWidth: 1,
    borderBottomColor: C.border,
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
  empty: {
    padding: 20,
    textAlign: 'center',
    color: C.textSecondary,
  },
});
