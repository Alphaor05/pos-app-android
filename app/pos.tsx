/** vCache_104 **/
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  ScrollView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
  RefreshControl,
  AppState,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  MaterialCommunityIcons,
  Ionicons,
  Feather,
  MaterialIcons,
} from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCart, CartItem } from '@/context/CartContext';
import { useBluetooth } from '@/context/BluetoothContext';
import { Product, DiscountPlan, PricingPlan } from '@/data/products';
import Colors from '@/constants/colors';

const C = Colors.dark;

async function fetchProductsFromSupabase(shopId: string | null): Promise<Product[]> {
  if (!supabase) {
    console.warn('fetchProducts: supabase client missing – using local cache');
    try {
      const { getProducts } = await import('@/lib/offlineDb');
      const local = await getProducts();
      return local.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category || '',
        image_url: p.image_url || '',
        inStock: p.in_stock ?? 9999,
      }));
    } catch (e) {
      console.warn('offlineDb error:', e);
      return [];
    }
  }

  let query = supabase.from('products').select('*, product_shop_stock(price, in_stock, available)');
  if (shopId) {
    query = query.eq('product_shop_stock.shop_id', shopId);
  }

  const { data, error } = await query.order('name', { ascending: true });
  if (error) {
    try {
      const { getProducts } = await import('@/lib/offlineDb');
      const local = await getProducts();
      return local.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category || '',
        image_url: p.image_url || '',
        inStock: p.in_stock ?? 9999,
      }));
    } catch (err) {
      console.warn('offlineDb error:', err);
      throw new Error(error.message);
    }
  }

  const merged = (data ?? []).map((p: any) => {
    const shopData = p.product_shop_stock && p.product_shop_stock.length > 0 ? p.product_shop_stock[0] : null;
    return {
      id: p.id,
      name: p.name,
      price: shopData && shopData.price !== null ? Number(shopData.price) : Number(p.price),
      category: p.category,
      image_url: p.image_url,
      sku: p.code || p.sku,
      // If no stock record exists for this shop, treat as 0 (not stocked here yet).
      // The offline fallback separately defaults to 9999 to keep cached products usable.
      inStock: shopData ? Number(shopData.in_stock ?? 0) : 0,
    };
  });

  // Sync to local DB
  try {
    const { clearProducts, addProduct } = await import('@/lib/offlineDb');
    await clearProducts();
    for (const p of merged) {
      await addProduct({ ...p as any, in_stock: (p as any).inStock ?? 9999 });
    }
  } catch (e) {
    console.warn('Sync products error:', e);
  }

  return merged as Product[];
}

async function fetchDiscountPlansFromSupabase(shopId: string | null): Promise<DiscountPlan[]> {
  if (!supabase) {
    try {
      const { getDiscountPlans } = await import('@/lib/offlineDb');
      return await getDiscountPlans(shopId);
    } catch (e) {
      console.warn('offlineDb discount error:', e);
      return [];
    }
  }

  let query = supabase
    .from('discount_plans')
    .select('*')
    .eq('status', 'active');
  
  if (shopId) {
    query = query.or(`shop_id.eq.${shopId},shop_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    try {
      const { getDiscountPlans } = await import('@/lib/offlineDb');
      return await getDiscountPlans(shopId);
    } catch (err) {
      console.warn('offlineDb discount error:', err);
      throw new Error(error.message);
    }
  }

  const results = (data ?? []) as DiscountPlan[];

  // Sync to local DB
  try {
    const { clearDiscountPlans, saveDiscountPlan } = await import('@/lib/offlineDb');
    await clearDiscountPlans();
    for (const p of results) {
      await saveDiscountPlan({ ...p, shop_id: shopId || '' } as any);
    }
  } catch (e) {
    console.warn('Sync discount plans error:', e);
  }

  return results;
}

async function fetchPricingPlansFromSupabase(shopId: string | null): Promise<PricingPlan[]> {
  if (!supabase) {
    try {
      const { getPricingPlans } = await import('@/lib/offlineDb');
      return await getPricingPlans(shopId);
    } catch (e) {
      console.warn('offlineDb pricing error:', e);
      return [];
    }
  }

  let query = supabase
    .from('pricing_plans')
    .select('*')
    .eq('status', 'active');
  
  if (shopId) {
    query = query.or(`shop_id.eq.${shopId},shop_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    try {
      const { getPricingPlans } = await import('@/lib/offlineDb');
      return await getPricingPlans(shopId);
    } catch (err) {
      console.warn('offlineDb pricing error:', err);
      throw new Error(error.message);
    }
  }

  const results = (data ?? []) as PricingPlan[];

  // Sync to local DB
  try {
    const { clearPricingPlans, savePricingPlan } = await import('@/lib/offlineDb');
    await clearPricingPlans();
    for (const p of results) {
      await savePricingPlan({ ...p, shop_id: shopId || '' } as any);
    }
  } catch (e) {
    console.warn('Sync pricing plans error:', e);
  }

  return results;
}

// Helper to normalize names for robust matching (lowercase + alphanumeric only)
const normalize = (val: string) => val ? val.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : '';

export default function POSScreen() {
  const { logout, employee, shopId } = useAuth();
  const { items, addItem, removeItem, updateQuantity, clearCart, total } = useCart();
  const { connectedDevice, status: btStatus, printReceipt } = useBluetooth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // 1. RESPONSIVE UTILS
  const isTablet = width >= 768;
  const isMobile = width < 768;
  const scale = width / 1024;
  const s = useCallback((val: number) => Math.floor(Math.max(val * scale, val * 0.75)), [scale]);

  // 2. ALL STATES
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('USD Cash');
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 3. ALL DATA QUERIES
  const {
    data: products = [],
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery<Product[]>({
    queryKey: ['supabase-products', shopId],
    queryFn: () => fetchProductsFromSupabase(shopId),
  });

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('payment_methods').select('*').eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!supabase,
  });

  const { data: activeDiscountPlans = [], refetch: refetchDiscounts } = useQuery<DiscountPlan[]>({
    queryKey: ['discount-plans', shopId],
    queryFn: () => fetchDiscountPlansFromSupabase(shopId),
  });

  const { data: activePricingPlans = [], refetch: refetchPricing } = useQuery<PricingPlan[]>({
    queryKey: ['pricing-plans', shopId],
    queryFn: () => fetchPricingPlansFromSupabase(shopId),
  });
  const { data: receiptDesign, error: designError } = useQuery({
    queryKey: ['receipt-design', shopId],
    queryFn: async () => {
      try {
        if (!shopId) return null;
        if (!supabase) throw new Error('Supabase client missing');

        const { data, error } = await supabase
          .from('receipt_designs')
          .select('*')
          .or(`shop_id.eq.${shopId},shop_id.is.null`)
          .order('shop_id', { ascending: false })
          .limit(1)
          .single();

        if (error) throw error;
        if (data && Platform.OS !== 'web') {
          const { saveReceiptDesign } = await import('@/lib/offlineDb');
          await saveReceiptDesign(data);
        }
        return data;
      } catch (err) {
        console.warn('Supabase receipt design fetch failed, trying local:', err);
        const { getReceiptDesign } = await import('@/lib/offlineDb');
        return await getReceiptDesign(shopId);
      }
    },
    enabled: !!shopId,
  });

  const queryClient = useQueryClient();

  // 4. ALL MEMOS AND CALLBACKS
  const styles = useMemo(() => createStyles(s, width, height, isMobile), [s, width, height, isMobile]);

  const parsedSettings = useMemo(() => {
    if (!receiptDesign) return undefined;
    return {
      header: receiptDesign.header,
      footer: receiptDesign.footer,
      receiptSize: receiptDesign.receipt_size,
    };
  }, [receiptDesign]);

  // Helper to check if a plan is valid based on dates (Local timezone safe)
  const isDateValid = useCallback((start: string, end: string) => {
    // Force local date parsing by using slashes instead of dashes if it's YYYY-MM-DD
    const startStr = start.length === 10 ? start.replace(/-/g, '/') : start;
    const endStr = end.length === 10 ? end.replace(/-/g, '/') : end;
    
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    
    if (start.length === 10) startDate.setHours(0, 0, 0, 0);
    if (end.length === 10) endDate.setHours(23, 59, 59, 999);
    
    return currentTime >= startDate && currentTime <= endDate;
  }, [currentTime]);

  const adjustedProducts = useMemo(() => {
    return products.map(p => {
      const targetName = normalize(p.name);
      const productCategory = normalize(p.category);

      // 1. Evaluate Pricing Plans (Multipliers)
      const pricingPlans = activePricingPlans.filter(plan => {
        if (plan.status !== 'active') return false;
        if (!isDateValid(plan.start_date, plan.end_date)) return false;
        if (plan.applicable_to === 'all') return true;
        
        const planTarget = normalize(plan.target_name || '');
        if (plan.applicable_to === 'product') {
          return plan.target_id === p.id || (planTarget && planTarget === targetName);
        }
        if (plan.applicable_to === 'category') {
          return planTarget && planTarget === productCategory;
        }
        return false;
      });

      let priceFromPricing = p.price;
      if (pricingPlans.length > 0) {
        let bestMult = 1;
        let set = false;
        pricingPlans.forEach(plan => {
          const mult = typeof plan.price_multiplier === 'string' ? parseFloat(plan.price_multiplier) : plan.price_multiplier;
          if (!isNaN(mult)) {
            if (!set || mult < bestMult) {
              bestMult = mult;
              set = true;
            }
          }
        });
        priceFromPricing = p.price * bestMult;
      }

      // 2. Evaluate Discount Plans (Direct discounts)
      const discountPlans = activeDiscountPlans.filter(plan => {
        if (plan.status !== 'active') return false;
        if (!isDateValid(plan.start_date, plan.end_date)) return false;
        if (plan.applicable_to === 'all') return true;

        const planTarget = normalize(plan.target_name || '');
        if (plan.applicable_to === 'product') {
          return plan.target_id === p.id || (planTarget && planTarget === targetName);
        }
        if (plan.applicable_to === 'category') {
          return planTarget && planTarget === productCategory;
        }
        return false;
      });

      let priceFromDiscount = p.price;
      if (discountPlans.length > 0) {
        let lowestPrice = p.price;
        discountPlans.forEach(plan => {
          const val = typeof plan.discount_value === 'string' ? parseFloat(plan.discount_value) : plan.discount_value;
          if (!isNaN(val)) {
            let discounted = p.price;
            if (plan.discount_type === 'percentage') {
              discounted = p.price * (1 - val / 100);
            } else {
              discounted = p.price - val;
            }
            if (discounted < lowestPrice) lowestPrice = discounted;
          }
        });
        priceFromDiscount = lowestPrice;
      }

      const finalPrice = Math.min(priceFromPricing, priceFromDiscount);

      return {
        ...p,
        price: finalPrice,
        originalPrice: p.price,
        isAdjusted: finalPrice !== p.price
      };
    });
  }, [products, activePricingPlans, activeDiscountPlans, isDateValid]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    adjustedProducts.forEach(p => { if (p.category) cats.add(p.category); });
    return ['All', ...Array.from(cats).sort()];
  }, [adjustedProducts]);

  const filteredProducts = useMemo(() => {
    return adjustedProducts.filter(p => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [adjustedProducts, search, selectedCategory]);

  const autoDiscountTotal = useMemo(() => {
    let totalDisc = 0;
    if (activeDiscountPlans.length === 0 || items.length === 0) return 0;

    items.forEach(item => {
      // Use the potentially adjusted product price from adjustedProducts
      const productInList = adjustedProducts.find(p => p.id === item.product.id);
      const currentPrice = productInList?.price || item.product.price;

      // Find plans applicable to this specific product OR its category OR 'all'
      const applicablePlans = activeDiscountPlans.filter(plan => {
        if (plan.status !== 'active') return false;
        if (!isDateValid(plan.start_date, plan.end_date)) return false;
        if (plan.applicable_to === 'all') return true;

        const targetName = normalize(plan.target_name || '');
        const productName = normalize(item.product.name || '');
        const productCategory = normalize(item.product.category || '');

        if (plan.applicable_to === 'product') {
          return plan.target_id === item.product.id || (targetName && targetName === productName);
        }
        if (plan.applicable_to === 'category') {
          return targetName && targetName === productCategory;
        }
        return false;
      });

      // For simplicity, we apply the BEST discount found if there are multiple
      let bestItemDisc = 0;
      applicablePlans.forEach(plan => {
        let disc = 0;
        const val = typeof plan.discount_value === 'string' ? parseFloat(plan.discount_value) : plan.discount_value;
        if (isNaN(val)) return;

        if (plan.discount_type === 'percentage') {
          disc = (currentPrice * item.quantity) * (val / 100);
        } else {
          disc = val * item.quantity;
        }
        if (disc > bestItemDisc) bestItemDisc = disc;
      });
      totalDisc += bestItemDisc;
    });

    return totalDisc;
  }, [items, activeDiscountPlans, adjustedProducts]);

  const manualDiscountAmount = parseFloat(discount) || 0;
  // NOTE: Cart total already uses the potentially discounted product price.
  // We do not subtract autoDiscountTotal here to avoid double-discounting.
  // The autoDiscountTotal is purely for UI display of "savings".
  const grandTotal = total - manualDiscountAmount;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  const refreshPending = useCallback(async () => {
    try {
      const { getPendingSales } = await import('@/lib/offlineDb');
      const list = await getPendingSales();
      setPendingCount(list.length);
    } catch (e) {
      console.warn('refreshPending error:', e);
    }
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLogout = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
    router.replace('/');
  };

  // 5. ALL EFFECTS

  // Periodic timer to keep plans in sync with current time (every 30 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethods.find((m: any) => m.payment_type_name === selectedPaymentMethod)) {
      setSelectedPaymentMethod(paymentMethods[0].payment_type_name);
    }
  }, [paymentMethods, selectedPaymentMethod]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // Refetch all critical data when returning to foreground
        refetch();
        refetchDiscounts();
        refetchPricing();
        refreshPending();
      }
    });
    return () => subscription.remove();
  }, [refetch, refetchDiscounts, refetchPricing, refreshPending]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);


  useEffect(() => {
    if (!supabase) return;
    const prodChannel = supabase
      .channel('inventory_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        queryClient.invalidateQueries({ queryKey: ['supabase-products', shopId] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'product_shop_stock',
        filter: shopId ? `shop_id=eq.${shopId}` : undefined
      }, async () => {
        queryClient.invalidateQueries({ queryKey: ['supabase-products', shopId] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'discount_plans'
      }, async () => {
        queryClient.invalidateQueries({ queryKey: ['discount-plans', shopId] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pricing_plans'
      }, async () => {
        queryClient.invalidateQueries({ queryKey: ['pricing-plans', shopId] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'receipt_designs'
      }, async () => {
        queryClient.invalidateQueries({ queryKey: ['receipt-design', shopId] });
      })
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(prodChannel);
    };
  }, [queryClient, shopId]);

  const handleCharge = async () => {
    if (items.length === 0) return;
    if (!shopId) {
      Alert.alert('Missing shop ID', 'Please set your shop/terminal in Settings before charging.');
      return;
    }

    const outOfStock = items.filter(i => (i.product.inStock ?? 0) <= 0);
    if (outOfStock.length > 0) {
      const names = outOfStock.map(i => i.product.name).join(', ');
      Alert.alert('Out of Stock', `Cannot complete sale — the following item(s) have no stock: ${names}`);
      return;
    }

    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const orderId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    const receiptItems = items.map(i => ({
      product_id: i.product.id,
      name: i.product.name,
      quantity: i.quantity,
      price: i.product.price,
    }));

    const totalDiscountInclAuto = manualDiscountAmount + autoDiscountTotal;

    const saleRecord: any = {
      orderId,
      items: receiptItems,
      subtotal: total,
      discount: totalDiscountInclAuto,
      tax: 0,
      total: grandTotal,
      createdAt: new Date().toISOString(),
      shopId,
      customerName: customerName.trim() || null,
      paymentMethod: selectedPaymentMethod,
    };

    try {
      const { queueSale } = await import('@/lib/offlineDb');
      await queueSale(saleRecord);
      refreshPending();
    } catch (e) {
      console.warn('failed to queue sale', e);
    }

    if (supabase && shopId) {
      try {
        const { handlePosSale, insertTransactionReceipt } = await import('@/lib/supabase');
        const { error } = await handlePosSale({
          p_shop_id: shopId,
          p_items: receiptItems,
          p_order_id: orderId,
          p_total_amount: Number(grandTotal),
          p_payment_method: selectedPaymentMethod,
          p_employee_id: employee?.employee_id ?? null,
          p_customer_name: customerName.trim() || null,
        });

        if (error) {
          console.warn('pos_sale RPC error (from handlePosSale)', error);
          // fallback: insert record to transaction_receipts table directly
          const receiptFallback = {
            order_id: orderId,
            shop_id: shopId,
            items: JSON.stringify(receiptItems),
            subtotal: total,
            discount: totalDiscountInclAuto,
            tax: 0,
            total: grandTotal,
            payment_method: selectedPaymentMethod,
            employee_id: employee?.employee_id || null,
            customer_name: customerName.trim() || null,
            created_at: new Date().toISOString(),
          };

          const { error: fallbackError } = await insertTransactionReceipt(receiptFallback);
          if (fallbackError) {
            console.error('Fallback transaction_receipts insert failed', fallbackError);
          }
        }
      } catch (e) {
        console.warn('pos_sale RPC handling exception', e);
      }
    }

    import('@/lib/sync').then(({ syncSalesQueue }) => syncSalesQueue());

    const { logActivity } = await import('@/lib/activityLogger');
    await logActivity('sale_complete', employee?.employee_id || null, {
      amount: grandTotal,
      discount: manualDiscountAmount + autoDiscountTotal,
    });

    try {
      const success = await printReceipt({
        orderId: saleRecord.orderId,
        items: saleRecord.items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.price
        })),
        subtotal: saleRecord.subtotal,
        discount: saleRecord.discount,
        tax: saleRecord.tax,
        total: saleRecord.total,
        createdAt: saleRecord.createdAt,
        paymentMethod: selectedPaymentMethod,
        settings: parsedSettings
      });

      if (!success) {
        Alert.alert(
          'Printer Error',
          'Sale was saved, but the receipt could not be printed. Please check your printer connection in Settings.',
          [{ text: 'OK' }]
        );
      }
    } catch (e) {
      console.warn('Silent local print failed', e);
      Alert.alert('Printer Error', 'A technical error occurred while trying to print.');
    }

    setOrderSuccess(true);
    setTimeout(() => {
      clearCart();
      setCustomerName('');
      setOrderSuccess(false);
    }, 1800);
  };

  const numColumns = width < 768 ? 2 : width < 1200 ? 4 : 5;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable style={styles.topBarIconBtn} onPress={() => setSidebarOpen(v => !v)}>
            <Ionicons name="menu" size={s(22)} color={C.text} />
          </Pressable>

          <View style={styles.searchBox}>
            <Feather name="search" size={s(16)} color={C.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Feather name="x" size={s(14)} color={C.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.topBarRight}>
          <Pressable style={styles.topBarIconBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={s(20)} color={C.textSecondary} />
          </Pressable>
          <Pressable style={styles.topBarIconBtn} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={s(20)} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {sidebarOpen && (
        <Pressable style={styles.sidebarOverlay} onPress={() => setSidebarOpen(false)}>
          <View style={styles.sidebarDropdown}>
            <SidebarItem icon="view-grid-outline" label="Products" active styles={styles} s={s} />
            {employee?.role === 'Admin' && (
              <>
                <SidebarItem icon="cart-outline" label="Sales" onPress={() => { setSidebarOpen(false); router.push('/sales'); }} styles={styles} s={s} />
                <SidebarItem icon="chart-bar" label="Reports" styles={styles} s={s} />
                <SidebarItem icon="account-multiple-outline" label="Customers" styles={styles} s={s} />
              </>
            )}
            <SidebarItem
              icon="cog-outline"
              label="Settings"
              onPress={() => { setSidebarOpen(false); router.push('/settings'); }}
              styles={styles}
              s={s}
            />
            <View style={styles.sidebarDivider} />
            <SidebarItem icon="logout" label="Logout" danger onPress={handleLogout} styles={styles} s={s} />
          </View>
        </Pressable>
      )}

      <View style={styles.body}>
        <View style={styles.mainArea}>
          {isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={styles.stateText}>Loading products...</Text>
            </View>
          ) : fetchError ? (
            <View style={styles.centerState}>
              <MaterialCommunityIcons name="alert-circle-outline" size={s(44)} color={C.danger} />
              <Text style={styles.stateText}>Failed to load products</Text>
              <Text style={styles.stateSubText}>{(fetchError as Error).message}</Text>
              <Pressable style={styles.retryBtn} onPress={() => refetch()}>
                <Feather name="refresh-cw" size={s(14)} color={C.accent} />
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={p => String(p.id)}
              numColumns={numColumns}
              key={`grid-${numColumns}`}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={[styles.gridContent, { paddingBottom: 60 + botPad }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={C.accent}
                  colors={[C.accent]}
                />
              }
              renderItem={({ item }) => (
                <ProductCard product={item} onPress={addItem} styles={styles} s={s} />
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Feather name="package" size={s(36)} color={C.textMuted} />
                  <Text style={styles.emptyText}>No products found</Text>
                </View>
              }
            />
          )}

          <View style={[styles.categoryBar, { bottom: botPad }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryBarContent}
            >
              {categories.map(cat => (
                <CategoryTab
                  key={cat}
                  label={cat}
                  selected={selectedCategory === cat}
                  onPress={() => setSelectedCategory(cat)}
                  styles={styles}
                />
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={[styles.cartPanel, { paddingBottom: botPad }]}>
          {items.length === 0 ? (
            <View style={styles.cartEmpty}>
              <MaterialCommunityIcons name="cart-outline" size={s(40)} color={C.textMuted} />
              <Text style={styles.cartEmptyText}>No items added</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => String(i.product.id)}
              showsVerticalScrollIndicator={false}
              style={styles.cartList}
              renderItem={({ item }) => (
                <CartRow item={item} onUpdate={updateQuantity} onRemove={removeItem} styles={styles} s={s} />
              )}
            />
          )}

          <View style={styles.cartFooter}>
            <View style={styles.customerInputRow}>
              <Ionicons name="person-outline" size={s(16)} color={C.textSecondary} />
              <TextInput
                style={styles.customerInput}
                placeholder="Name..."
                placeholderTextColor={C.textMuted}
                value={customerName}
                onChangeText={setCustomerName}
              />
              {customerName.length > 0 && (
                <Pressable onPress={() => setCustomerName('')}>
                  <Feather name="x" size={s(14)} color={C.textSecondary} />
                </Pressable>
              )}
            </View>

            {items.length > 0 && (
              <View style={styles.actionBtns}>
                <Pressable style={styles.clearRow} onPress={async () => {
                  const { logActivity } = await import('@/lib/activityLogger');
                  await logActivity('transaction_cancelled', employee?.employee_id || null);
                  clearCart();
                }}>
                  <Feather name="trash-2" size={s(13)} color={C.danger} />
                  <Text style={styles.clearRowText}>Clear</Text>
                </Pressable>
                <Pressable style={styles.voidBtn} onPress={async () => {
                  const { logActivity } = await import('@/lib/activityLogger');
                  await logActivity('transaction_void', employee?.employee_id || null, { amount: grandTotal });
                  clearCart();
                  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                }}>
                  <Text style={styles.voidBtnText}>VOID</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.totalsBox}>
              <TotalRow label="Sub Total" value={total.toFixed(2)} styles={styles} />
              <View style={styles.discountRow}>
                <Text style={styles.totalLabelText}>Manual Discount</Text>
                <TextInput
                  style={styles.discountInput}
                  value={discount}
                  onChangeText={setDiscount}
                  keyboardType="numeric"
                  selectTextOnFocus
                />
              </View>

              {autoDiscountTotal > 0 && (
                <View style={styles.discountRow}>
                  <Text style={[styles.totalLabelText, { color: C.success }]}>Auto Discount</Text>
                  <Text style={[styles.totalValueText, { color: C.success }]}>
                    -{autoDiscountTotal.toFixed(2)}
                  </Text>
                </View>
              )}

              <View style={styles.totalsLine} />
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Total</Text>
                <View style={styles.grandTotalRight}>
                  <View style={styles.itemCountBadge}>
                    <Text style={styles.itemCountText}>{itemCount}</Text>
                  </View>
                  <Text style={styles.grandTotalValue}>
                    {grandTotal > 0 ? grandTotal.toFixed(2) : '0.00'}
                  </Text>
                </View>
              </View>
            </View>

            {btStatus === 'connected' && connectedDevice && (
              <View style={styles.printerBadge}>
                <MaterialCommunityIcons name="printer-check" size={s(11)} color={C.success} />
                <Text style={styles.printerBadgeText}>{connectedDevice.name}</Text>
              </View>
            )}
            
            <View style={styles.actionBtns}>
              <Pressable
                style={styles.paymentSelector}
                onPress={() => setShowPaymentPicker(true)}
              >
                <View style={styles.paymentSelectorLeft}>
                  <Text style={styles.paymentSelectorLabel}>PAY</Text>
                  <Text style={styles.paymentSelectorValue} numberOfLines={1}>{selectedPaymentMethod}</Text>
                </View>
                <MaterialIcons name="arrow-drop-down" size={s(20)} color={C.textSecondary} />
              </Pressable>

              <Modal
                visible={showPaymentPicker}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowPaymentPicker(false)}
              >
                <Pressable
                  style={styles.modalOverlay}
                  onPress={() => setShowPaymentPicker(false)}
                >
                  <View style={styles.pickerModal}>
                    <Text style={styles.pickerTitle}>Payment Method</Text>
                    <FlatList
                      data={paymentMethods}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => (
                        <Pressable
                          style={[
                            styles.pickerOption,
                            selectedPaymentMethod === item.payment_type_name && styles.pickerOptionSelected
                          ]}
                          onPress={() => {
                            setSelectedPaymentMethod(item.payment_type_name);
                            setShowPaymentPicker(false);
                          }}
                        >
                          <Text style={[
                            styles.pickerOptionText,
                            selectedPaymentMethod === item.payment_type_name && styles.pickerOptionTextSelected
                          ]}>
                            {item.payment_type_name}
                          </Text>
                          {selectedPaymentMethod === item.payment_type_name && (
                            <Ionicons name="checkmark-circle" size={s(18)} color={C.accent} />
                          )}
                        </Pressable>
                      )}
                    />
                  </View>
                </Pressable>
              </Modal>

              <Pressable
                style={[
                  styles.chargeBtn,
                  (items.length === 0 || !shopId) && styles.chargeBtnDisabled,
                  orderSuccess && styles.chargeBtnSuccess,
                ]}
                onPress={handleCharge}
                disabled={items.length === 0 || !shopId}
              >
                <Text style={styles.chargeBtnText}>
                  {orderSuccess ? 'OK!' : 'CHARGE'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  danger,
  onPress,
  styles,
  s,
}: {
  icon: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress?: () => void;
  styles: any;
  s: any;
}) {
  return (
    <Pressable style={[styles.sidebarItem, active && styles.sidebarItemActive]} onPress={onPress}>
      <MaterialCommunityIcons
        name={icon as any}
        size={s(20)}
        color={danger ? C.danger : active ? C.accent : C.textSecondary}
      />
      <Text style={[
        styles.sidebarItemText,
        active && styles.sidebarItemTextActive,
        danger && styles.sidebarItemTextDanger,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryTab({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: any }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.categoryTab, selected && styles.categoryTabSelected]}
    >
      <Text style={[styles.categoryTabText, selected && styles.categoryTabTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProductCard({ product, onPress, styles, s }: { product: Product; onPress: (p: Product) => void; styles: any; s: any }) {
  const isOutOfStock = (product.inStock ?? 0) <= 0;
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (isOutOfStock) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(product);
  };

  return (
    <Pressable
      onPressIn={() => { if (!isOutOfStock) scale.value = withSpring(0.95, { damping: 10 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 10 }); }}
      onPress={handlePress}
      style={[styles.productCardWrap, isOutOfStock && { opacity: 0.6 }]}
      disabled={isOutOfStock}
    >
      <Animated.View style={[styles.productCard, animStyle]}>
        <Image
          source={{ uri: product.image_url }}
          style={styles.productImage}
          contentFit="cover"
          transition={200}
        />
        {isOutOfStock ? (
          <View style={styles.outOfStockOverlay}>
            <Text style={styles.outOfStockText}>OUT</Text>
          </View>
        ) : (product.inStock ?? 0) < 10 && (
          <View style={styles.lowStockOverlay}>
            <Text style={styles.lowStockText}>LOW ({product.inStock})</Text>
          </View>
        )}
        <View style={styles.productInfo}>
          {!!product.category && (
            <Text style={styles.productCategory} numberOfLines={1}>{product.category}</Text>
          )}
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <View style={styles.productPriceRow}>
            <Text style={styles.productPrice}>
              ${typeof product.price === 'number' ? product.price.toFixed(2) : product.price}
            </Text>
            <Pressable
              style={[styles.addBtn, isOutOfStock && styles.addBtnDisabled]}
              onPress={handlePress}
              disabled={isOutOfStock}
            >
              <Feather name="plus" size={s(13)} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function CartRow({
  item,
  onUpdate,
  onRemove,
  styles,
  s,
}: {
  item: CartItem;
  onUpdate: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  styles: any;
  s: any;
}) {
  const subtotal = item.product.price * item.quantity;
  return (
    <View style={styles.cartRow}>
      <Text style={styles.cartItemQty}>{item.quantity}x</Text>
      <Text style={styles.cartItemName} numberOfLines={1}>{item.product.name}</Text>
      <Text style={styles.cartItemPrice}>{subtotal.toFixed(2)}</Text>
      <View style={styles.cartRowActions}>
        <Pressable style={styles.qtyMiniBtn} onPress={() => onUpdate(String(item.product.id), item.quantity - 1)}>
          <Feather name="minus" size={s(11)} color={C.text} />
        </Pressable>
        <Pressable style={styles.qtyMiniBtn} onPress={() => onUpdate(String(item.product.id), item.quantity + 1)}>
          <Feather name="plus" size={s(11)} color={C.text} />
        </Pressable>
        <Pressable style={styles.removeMiniBtn} onPress={() => onRemove(String(item.product.id))}>
          <Feather name="x" size={s(11)} color={C.danger} />
        </Pressable>
      </View>
    </View>
  );
}

function TotalRow({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabelText}>{label}</Text>
      <Text style={styles.totalValueText}>{value}</Text>
    </View>
  );
}

const createStyles = (s: (v: number) => number, width: number, height: number, isMobile: boolean) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    zIndex: 10,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    flex: 1,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  topBarIconBtn: {
    width: s(36),
    height: s(36),
    borderRadius: s(8),
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(7),
    gap: s(8),
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: s(320),
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: s(14),
    color: C.text,
    padding: 0,
  },
  sidebarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  sidebarDropdown: {
    position: 'absolute',
    top: s(52),
    left: s(12),
    width: s(220),
    backgroundColor: C.surface,
    borderRadius: s(14),
    paddingVertical: s(8),
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    gap: s(2),
  },
  sidebarDivider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: s(12),
    marginVertical: s(4),
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingHorizontal: s(16),
    paddingVertical: s(11),
    borderRadius: s(10),
    marginHorizontal: s(6),
  },
  sidebarItemActive: {
    backgroundColor: C.accentDim,
  },
  sidebarItemText: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(14),
    color: C.textSecondary,
  },
  sidebarItemTextActive: {
    color: C.accentLight,
  },
  sidebarItemTextDanger: {
    color: C.danger,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  mainArea: {
    flex: 1,
    backgroundColor: C.background,
    position: 'relative',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(12),
    paddingBottom: s(60),
  },
  stateText: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(15),
    color: C.textSecondary,
  },
  stateSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(13),
    color: C.textMuted,
    textAlign: 'center',
    maxWidth: s(320),
    paddingHorizontal: s(20),
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: C.accentDim,
    paddingHorizontal: s(18),
    paddingVertical: s(10),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: C.accent,
    marginTop: s(4),
  },
  retryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: s(14),
    color: C.accent,
  },
  gridContent: {
    padding: s(10),
    gap: s(10),
  },
  gridRow: {
    gap: s(10),
  },
  productCardWrap: {
    flex: 1,
  },
  productCard: {
    backgroundColor: C.card,
    borderRadius: s(12),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  productImage: {
    width: '100%',
    aspectRatio: 1.1,
    backgroundColor: C.surface,
  },
  lowStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    aspectRatio: 1.1,
    backgroundColor: 'rgba(255, 0, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowStockText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(10),
    color: '#fff',
    backgroundColor: 'rgba(255, 0, 0, 0.6)',
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: s(4),
    transform: [{ rotate: '-10deg' }],
  },
  outOfStockOverlay: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    aspectRatio: 1.1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outOfStockText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(10),
    color: '#fff',
    backgroundColor: 'rgba(80, 80, 80, 0.85)',
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: s(4),
    transform: [{ rotate: '-10deg' }],
    letterSpacing: 0.5,
  },
  productInfo: {
    padding: s(8),
    gap: s(2),
  },
  productCategory: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(10),
    color: C.accentLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  productName: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(12),
    color: C.text,
    lineHeight: s(17),
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: s(2),
  },
  productPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: s(12),
    color: C.textSecondary,
  },
  addBtn: {
    width: s(22),
    height: s(22),
    borderRadius: s(6),
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: C.textMuted,
    opacity: 0.5,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: s(80),
    gap: s(10),
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(14),
    color: C.textMuted,
  },
  categoryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    height: s(52),
    justifyContent: 'center',
  },
  categoryBarContent: {
    paddingHorizontal: s(10),
    gap: s(6),
    alignItems: 'center',
  },
  categoryTab: {
    paddingHorizontal: s(16),
    paddingVertical: s(7),
    borderRadius: s(8),
    backgroundColor: C.card,
  },
  categoryTabSelected: {
    backgroundColor: C.accent,
  },
  categoryTabText: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(13),
    color: C.textSecondary,
  },
  categoryTabTextSelected: {
    color: '#fff',
  },
  cartPanel: {
    width: isMobile ? width * 0.35 : s(240),
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    flexDirection: 'column',
  },
  cartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
  },
  cartEmptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(13),
    color: C.textMuted,
  },
  cartList: {
    flex: 1,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(10),
    paddingVertical: s(8),
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: s(4),
  },
  cartItemQty: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: s(12),
    color: C.accent,
    width: s(22),
  },
  cartItemName: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(12),
    color: C.text,
    flex: 1,
  },
  cartItemPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: s(12),
    color: C.text,
  },
  cartRowActions: {
    flexDirection: 'row',
    gap: s(3),
  },
  qtyMiniBtn: {
    width: s(22),
    height: s(22),
    borderRadius: s(5),
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  removeMiniBtn: {
    width: s(22),
    height: s(22),
    borderRadius: s(5),
    backgroundColor: C.dangerDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartFooter: {
    paddingHorizontal: s(10),
    paddingTop: s(8),
    paddingBottom: s(10),
    gap: s(8),
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    justifyContent: 'flex-end',
  },
  clearRowText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(11),
    color: C.danger,
  },
  totalsBox: {
    gap: s(4),
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabelText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(12),
    color: C.textSecondary,
  },
  totalValueText: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(12),
    color: C.textSecondary,
  },
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  discountInput: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(12),
    color: C.text,
    backgroundColor: C.card,
    borderRadius: s(6),
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderWidth: 1,
    borderColor: C.border,
    width: s(60),
    textAlign: 'right',
  },
  totalsLine: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: s(3),
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandTotalLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(14),
    color: C.text,
  },
  grandTotalRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  itemCountBadge: {
    backgroundColor: C.accent,
    borderRadius: s(10),
    minWidth: s(20),
    height: s(20),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(5),
  },
  itemCountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(11),
    color: '#fff',
  },
  grandTotalValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(16),
    color: C.text,
  },
  printerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
  },
  printerBadgeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: s(11),
    color: C.success,
  },
  actionBtns: {
    flexDirection: 'row',
    gap: s(8),
  },
  chargeBtn: {
    flex: 1.5,
    backgroundColor: C.accent,
    borderRadius: s(10),
    paddingVertical: s(12),
    alignItems: 'center',
  },
  chargeBtnDisabled: {
    opacity: 0.4,
  },
  chargeBtnSuccess: {
    backgroundColor: C.success,
  },
  chargeBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(14),
    color: '#fff',
  },
  pendingBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: s(10),
    color: '#fff',
  },
  customerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: s(10),
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    marginBottom: s(8),
    borderWidth: 1,
    borderColor: C.border,
    gap: s(8),
  },
  customerInput: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: s(14),
    color: C.text,
    padding: 0,
  },
  voidBtn: {
    marginTop: s(4),
    backgroundColor: C.dangerDim,
    borderRadius: s(10),
    paddingVertical: s(10),
    alignItems: 'center',
    flex: 1,
  },
  voidBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(14),
    color: C.danger,
  },
  pendingBadge: {
    position: 'absolute',
    top: s(6),
    right: s(6),
    backgroundColor: C.warningDim,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: s(8),
  },
  paymentSelector: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: s(10),
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: C.border,
  },
  paymentSelectorLeft: {
    gap: 1,
    flex: 1,
  },
  paymentSelectorLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(10),
    color: C.textMuted,
    textTransform: 'uppercase',
  },
  paymentSelectorValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(13),
    color: C.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerModal: {
    width: '80%',
    maxWidth: s(350),
    backgroundColor: C.surface,
    borderRadius: s(16),
    padding: s(16),
    maxHeight: '60%',
    borderWidth: 1,
    borderColor: C.border,
  },
  pickerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(16),
    color: C.text,
    marginBottom: s(16),
    textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(14),
    paddingHorizontal: s(12),
    borderRadius: s(10),
    marginBottom: s(4),
  },
  pickerOptionSelected: {
    backgroundColor: C.accentDim,
  },
  pickerOptionText: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(15),
    color: C.textSecondary,
  },
  pickerOptionTextSelected: {
    color: C.accentLight,
  },
});
