import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSpring,
  Easing 
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MaterialCommunityIcons,
  Ionicons,
  Feather,
} from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { getAllSales, SaleRecord } from '@/lib/offlineDb';

const C = Colors.dark;

type FilterType = 'Today' | 'Yesterday' | 'This Week' | 'Last Week' | 'This Month' | 'Last Month' | 'This Year' | 'Last Year';
type TabType = 'Summary' | 'By Day' | 'By Product' | 'By Category' | 'Payment' | 'Sales';

const FILTERS: FilterType[] = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month', 'This Year', 'Last Year'];
const TABS: TabType[] = ['Summary', 'By Day', 'By Product', 'By Category', 'Payment', 'Sales'];

export default function ReportsScreen() {
  const { shopId } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = width / 1024;
  const s = useCallback((val: number) => Math.floor(Math.max(val * scale, val * 0.75)), [scale]);

  const [loading, setLoading] = useState(true);
  const [rawSales, setRawSales] = useState<SaleRecord[]>([]);
  const [filter, setFilter] = useState<FilterType>('This Month');
  const [activeTab, setActiveTab] = useState<TabType>('Summary');

  const rotation = useSharedValue(0);
  const btnScale = useSharedValue(1);

  useEffect(() => {
    if (loading) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = withTiming(0);
    }
  }, [loading]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllSales();
      const shopSales = all.filter(s => s.data?.shopId === shopId || s.data?.shop_id === shopId);
      setRawSales(shopSales);
    } catch (e) {
      console.error('[Reports] Failed to load local sales:', e);
    } finally {
      // Small artificial delay for animation smoothness if it loads too fast
      setTimeout(() => setLoading(false), 600);
    }
  }, [shopId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getDateRange = (filter: FilterType) => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    switch (filter) {
      case 'Today':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'Yesterday':
        start.setDate(now.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(now.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        break;
      case 'This Week': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      }
      case 'Last Week': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        end.setDate(diff + 6);
        end.setHours(23, 59, 59, 999);
        break;
      }
      case 'This Month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'Last Month':
        start.setMonth(now.getMonth() - 1);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(now.getMonth());
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'This Year':
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'Last Year':
        start.setFullYear(now.getFullYear() - 1);
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        end.setFullYear(now.getFullYear() - 1);
        end.setMonth(11, 31);
        end.setHours(23, 59, 59, 999);
        break;
    }
    return { start, end };
  };

  const filteredSales = useMemo(() => {
    const { start, end } = getDateRange(filter);
    return rawSales.filter(sale => {
      const saleDate = new Date(sale.data?.createdAt || sale.created_at);
      return saleDate >= start && saleDate <= end;
    });
  }, [rawSales, filter]);

  const reportData = useMemo(() => {
    let totalRevenue = 0;
    let totalDiscount = 0;
    let totalSalesCount = filteredSales.length;

    let todayRevenue = 0;
    let todaySalesCount = 0;
    const todayStr = new Date().toLocaleDateString();

    const byDay: Record<string, { date: string; revenue: number; count: number }> = {};
    const byPayment: Record<string, { method: string; revenue: number; count: number }> = {};
    const byProduct: Record<string, { id: string; name: string; revenue: number; quantity: number }> = {};
    const byCategory: Record<string, { name: string; revenue: number; quantity: number }> = {};

    // For "Today" metrics, we check the rawSales (all shop sales) to ensure we always have today's snapshot
    rawSales.forEach(sale => {
      const data = sale.data;
      const saleDate = new Date(data.createdAt || sale.created_at);
      if (saleDate.toLocaleDateString() === todayStr) {
        todayRevenue += data.total || 0;
        todaySalesCount += 1;
      }
    });

    filteredSales.forEach(sale => {
      const data = sale.data;
      const rev = data.total || 0;
      const disc = data.discount || 0;
      
      totalRevenue += rev;
      totalDiscount += disc;

      // By Day
      const dayKey = new Date(data.createdAt || sale.created_at).toLocaleDateString();
      if (!byDay[dayKey]) byDay[dayKey] = { date: dayKey, revenue: 0, count: 0 };
      byDay[dayKey].revenue += rev;
      byDay[dayKey].count += 1;

      // By Payment
      const payMethod = data.paymentMethod || 'Unknown';
      if (!byPayment[payMethod]) byPayment[payMethod] = { method: payMethod, revenue: 0, count: 0 };
      byPayment[payMethod].revenue += rev;
      byPayment[payMethod].count += 1;

      // By Product & Category
      const items = data.items || [];
      items.forEach((item: any) => {
        const pId = item.product_id || item.id;
        const pName = item.name || 'Unknown Product';
        const pQty = item.quantity || 0;
        const pRev = (item.price || 0) * pQty;
        
        if (!byProduct[pId]) byProduct[pId] = { id: pId, name: pName, revenue: 0, quantity: 0 };
        byProduct[pId].revenue += pRev;
        byProduct[pId].quantity += pQty;

        const cat = item.category || 'Uncategorized';
        if (!byCategory[cat]) byCategory[cat] = { name: cat, revenue: 0, quantity: 0 };
        byCategory[cat].revenue += pRev;
        byCategory[cat].quantity += pQty;
      });
    });

    return {
      summary: {
        count: totalSalesCount,
        revenue: totalRevenue,
        discount: totalDiscount,
        net: totalRevenue,
        todayRevenue,
        todayCount: todaySalesCount
      },
      byDay: Object.values(byDay).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      byPayment: Object.values(byPayment).sort((a, b) => b.revenue - a.revenue),
      byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
      byCategory: Object.values(byCategory).sort((a, b) => b.revenue - a.revenue),
      sales: [...filteredSales].sort((a, b) => new Date(b.data?.createdAt || b.created_at).getTime() - new Date(a.data?.createdAt || a.created_at).getTime()),
    };
  }, [rawSales, filteredSales]);

  const handleFilterChange = (f: FilterType) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilter(f);
  };

  const handleTabChange = (t: TabType) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(t);
  };

  if (!shopId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={s(22)} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Local Reports</Text>
        </View>
        <View style={styles.centerState}>
          <Feather name="alert-triangle" size={s(44)} color={C.warning} />
          <Text style={styles.stateText}>No shop assigned to this terminal</Text>
          <Text style={styles.stateSubText}>Please assign a shop in Settings to view local reports.</Text>
        </View>
      </View>
    );
  }

  const renderSummary = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
      <View style={styles.summaryGrid}>
        <SummaryCard 
          icon="calendar-today" 
          label="Sales Today" 
          value={reportData.summary.todayCount.toString()} 
          color={C.accentLight} 
          s={s} 
        />
        <SummaryCard 
          icon="currency-usd" 
          label="Revenue Today" 
          value={`$${reportData.summary.todayRevenue.toFixed(2)}`} 
          color={C.success} 
          s={s} 
        />
        
        <View style={styles.divider} />
        
        <SummaryCard 
          icon="cart-outline" 
          label={`${filter} Sales`} 
          value={reportData.summary.count.toString()} 
          color={C.textSecondary} 
          s={s} 
        />
        <SummaryCard 
          icon="cash-multiple" 
          label={`${filter} Revenue`} 
          value={`$${reportData.summary.revenue.toFixed(2)}`} 
          color={C.success} 
          s={s} 
        />
        <SummaryCard 
          icon="tag-outline" 
          label={`${filter} Disc.`} 
          value={`$${reportData.summary.discount.toFixed(2)}`} 
          color={C.warning} 
          s={s} 
        />
        <SummaryCard 
          icon="bank-outline" 
          label={`${filter} Net`} 
          value={`$${reportData.summary.net.toFixed(2)}`} 
          color={C.accent} 
          s={s} 
        />
      </View>
    </ScrollView>
  );

  const renderByDay = () => (
    <FlatList
      data={reportData.byDay}
      keyExtractor={item => item.date}
      contentContainerStyle={styles.tabContent}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View>
            <Text style={styles.listItemTitle}>{item.date}</Text>
            <Text style={styles.listItemSub}>{item.count} sales</Text>
          </View>
          <Text style={styles.listItemValue}>${item.revenue.toFixed(2)}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No data for this period</Text>}
    />
  );

  const renderByProduct = () => (
    <FlatList
      data={reportData.byProduct}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.tabContent}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.listItemTitle} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.listItemSub}>{item.quantity} units sold</Text>
          </View>
          <Text style={styles.listItemValue}>${item.revenue.toFixed(2)}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No data for this period</Text>}
    />
  );

  const renderByCategory = () => (
    <FlatList
      data={reportData.byCategory}
      keyExtractor={item => item.name}
      contentContainerStyle={styles.tabContent}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View>
            <Text style={styles.listItemTitle}>{item.name}</Text>
            <Text style={styles.listItemSub}>{item.quantity} items sold</Text>
          </View>
          <Text style={styles.listItemValue}>${item.revenue.toFixed(2)}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No data for this period</Text>}
    />
  );

  const renderByPayment = () => (
    <FlatList
      data={reportData.byPayment}
      keyExtractor={item => item.method}
      contentContainerStyle={styles.tabContent}
      renderItem={({ item }) => (
        <View style={styles.listItem}>
          <View>
            <Text style={styles.listItemTitle}>{item.method}</Text>
            <Text style={styles.listItemSub}>{item.count} transactions</Text>
          </View>
          <Text style={styles.listItemValue}>${item.revenue.toFixed(2)}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.emptyText}>No data for this period</Text>}
    />
  );

  const renderIndividualSales = () => (
    <FlatList
      data={reportData.sales}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.tabContent}
      renderItem={({ item }) => {
        const d = item.data;
        return (
          <View style={styles.saleItem}>
            <View style={styles.saleHeader}>
              <Text style={styles.saleTime}>
                {new Date(d.createdAt || item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <View style={[styles.syncBadge, item.synced ? styles.synced : styles.unsynced]}>
                <Text style={[styles.syncBadgeText, item.synced ? styles.syncedText : styles.unsyncedText]}>
                  {item.synced ? 'SYNCED' : 'PENDING'}
                </Text>
              </View>
            </View>
            <Text style={styles.saleItems} numberOfLines={1}>
              {d.items.map((i: any) => i.name).join(', ')}
            </Text>
            <View style={styles.saleFooter}>
              <Text style={styles.saleCashier}>{d.employeeName || 'Unknown Staff'}</Text>
              <Text style={styles.saleTotal}>${d.total.toFixed(2)} • {d.paymentMethod}</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={<Text style={styles.emptyText}>No sales found</Text>}
    />
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={s(22)} color={C.text} />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>Local Reports</Text>
            <View style={styles.localBanner}>
              <Feather name="database" size={s(10)} color={C.accentLight} />
              <Text style={styles.localBannerText}>DEVICE DATA ONLY</Text>
            </View>
          </View>
        </View>
        <Animated.View style={animatedBtnStyle}>
          <Pressable 
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              loadData();
            }} 
            onPressIn={() => { btnScale.value = withSpring(0.9); }}
            onPressOut={() => { btnScale.value = withSpring(1); }}
            style={styles.refreshBtn}
            disabled={loading}
          >
            <Animated.View style={animatedIconStyle}>
              <Feather name="refresh-cw" size={s(18)} color={loading ? C.accent : C.textSecondary} />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {FILTERS.map(f => (
            <Pressable
              key={f}
              onPress={() => handleFilterChange(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
          {TABS.map(t => (
            <Pressable
              key={t}
              onPress={() => handleTabChange(t)}
              style={[styles.tabItem, activeTab === t && styles.tabItemActive]}
            >
              <Text style={[styles.tabItemText, activeTab === t && styles.tabItemTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={styles.stateText}>Analyzing sales...</Text>
          </View>
        ) : (
          <>
            {activeTab === 'Summary' && renderSummary()}
            {activeTab === 'By Day' && renderByDay()}
            {activeTab === 'By Product' && renderByProduct()}
            {activeTab === 'By Category' && renderByCategory()}
            {activeTab === 'Payment' && renderByPayment()}
            {activeTab === 'Sales' && renderIndividualSales()}
          </>
        )}
      </View>
    </View>
  );
}

function SummaryCard({ icon, label, value, color, s }: { icon: string; label: string; value: string; color: string; s: any }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.cardIconBox, { backgroundColor: color + '20' }]}>
        <MaterialCommunityIcons name={icon as any} size={s(20)} color={color} />
      </View>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
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
    backgroundColor: C.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  localBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  localBannerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    color: C.accentLight,
    letterSpacing: 0.5,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  filterContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterChipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  filterChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
  },
  tabBar: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tabBarContent: {
    paddingHorizontal: 14,
    gap: 0,
  },
  tabItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: C.accent,
  },
  tabItemText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.textMuted,
  },
  tabItemTextActive: {
    color: C.accent,
    fontFamily: 'Inter_600SemiBold',
  },
  content: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
    gap: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: C.border,
    marginVertical: 8,
    opacity: 0.5,
  },
  summaryCard: {
    width: '48%', // Rough 2-column grid
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  cardValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  cardLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textMuted,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.card,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  listItemTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  listItemSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  listItemValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.textSecondary,
  },
  saleItem: {
    backgroundColor: C.card,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  saleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saleTime: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  syncBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  synced: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  unsynced: {
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
  },
  syncBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 8,
  },
  syncedText: {
    color: '#4CAF50',
  },
  unsyncedText: {
    color: '#FF9800',
  },
  saleItems: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
  },
  saleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: C.border + '50',
    paddingTop: 6,
  },
  saleCashier: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: C.textMuted,
  },
  saleTotal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.accentLight,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  stateText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: C.textSecondary,
  },
  stateSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
