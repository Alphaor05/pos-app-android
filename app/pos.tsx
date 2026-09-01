/** vCache_104 **/
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  DeviceEventEmitter,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
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
import { MessageNotificationsBell } from '@/components/messages/NotificationsBell';
import { useCart, CartItem } from '@/context/CartContext';
import { usePrinter } from '@/context/PrinterContext';
import { Product, DiscountPlan, PricingPlan } from '@/data/products';
import Colors from '@/constants/colors';

const C = Colors.dark;

const PRODUCT_PAGE_SIZE = 1000;

// Bounding the network phase so a device that is offline (or on a network with
// no route) can NEVER leave the POS stuck on the loading spinner. NetInfo gives
// a fast signal; the timeouts cover the "connected but no internet" case where
// a fetch would otherwise hang for a very long time.
const NETWORK_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Network timeout')), ms);
    promise.then(
      (val) => { clearTimeout(id); resolve(val); },
      (err) => { clearTimeout(id); reject(err); }
    );
  });
}

async function hasNetwork(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch (e) {
    console.warn('[products] NetInfo check failed:', e);
    return true; // unknown → let the request try with its own timeout
  }
}

async function loadProductsFromCache(shopId: string | null): Promise<Product[]> {
  const { getProducts } = await import('@/lib/offlineDb');
  const local = await getProducts(shopId);
  if (local.length === 0) {
    // Never let a failed fetch blank out a fuller in-memory list: if there is
    // no usable cache, surface an error (React Query keeps the last good data)
    // instead of replacing it with an empty array.
    throw new Error('No cached products available offline');
  }
  return local.map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category || '',
    image_url: p.image_url || '',
    inStock: p.in_stock ?? 9999,
    allowNegativeStock: !!p.allow_negative_stock,
  }));
}

async function fetchProductsFromSupabase(shopId: string | null): Promise<Product[]> {
  if (!supabase) {
    console.warn('fetchProducts: supabase client missing – using local cache');
    return loadProductsFromCache(shopId);
  }

  // Fast connectivity probe: if the device reports no internet, skip the
  // network entirely and serve the last-known-good cache. Without this the
  // Supabase request can hang indefinitely on a restart while offline, leaving
  // the POS stuck on "Loading products...".
  if (!(await hasNetwork())) {
    console.warn('fetchProducts: offline (NetInfo) – using local cache');
    return loadProductsFromCache(shopId);
  }

  // Fetch the ENTIRE catalog (paginated) so the offline cache is never a
  // truncated subset of what the shop actually sells. Supabase caps rows per
  // request (default 1000), so a single `.limit()` call silently drops the
  // rest — those products then vanish whenever the device goes offline.
  // Ask the server for the expected row count so we can detect an incomplete
  // download (server row cap) and refuse to overwrite a complete cache with a
  // truncated one.
  let expected: number | null = null;
  try {
    let countQuery = supabase.from('products').select('*', { count: 'exact', head: true });
    if (shopId) {
      countQuery = countQuery.eq('product_shop_stock.shop_id', shopId);
    }
    const countRes = await withTimeout(countQuery, CONNECT_TIMEOUT_MS);
    if (!countRes.error && typeof countRes.count === 'number') {
      expected = countRes.count;
    }
  } catch (e) {
    // Count request timed out → almost certainly offline. Serve the cache now
    // instead of burning another timeout on the full download below.
    console.warn('[products] count query timed out – using local cache:', e);
    return loadProductsFromCache(shopId);
  }

  let allRows: any[] = [];
  try {
    let query = supabase.from('products').select('*, product_shop_stock(price, in_stock, available)').order('name', { ascending: true });
    if (shopId) {
      query = query.eq('product_shop_stock.shop_id', shopId);
    }
    for (let from = 0; expected === null || allRows.length < expected; from += PRODUCT_PAGE_SIZE) {
      const { data, error } = await withTimeout(query.range(from, from + PRODUCT_PAGE_SIZE - 1), NETWORK_TIMEOUT_MS);
      if (error) throw error;
      const page = data ?? [];
      allRows.push(...page);
      if (page.length < PRODUCT_PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn('fetchProducts error – using local cache:', err);
    return loadProductsFromCache(shopId);
  }

  const merged = (allRows ?? []).map((p: any) => {
    const shopData = p.product_shop_stock && p.product_shop_stock.length > 0 ? p.product_shop_stock[0] : null;
    return {
      id: p.id,
      name: p.name,
      price: shopData && shopData.price !== null ? Number(shopData.price) : Number(p.price),
      category: p.category,
      image_url: p.image_url,
      sku: p.code || p.sku,
      inStock: shopData ? Number(shopData.in_stock ?? 0) : 0,
      allowNegativeStock: !!p.allow_negative_stock,
    };
  });

  const fetchComplete = expected === null || allRows.length >= expected;
  if (!fetchComplete) {
    // Do NOT replace the cached catalog with a partial download: serve the
    // last complete cache, or the partial fresh data if no cache exists.
    console.warn(`[products] download incomplete (${allRows.length}/${expected}) – keeping existing cache`);
    try {
      return await loadProductsFromCache(shopId);
    } catch {
      return merged as Product[];
    }
  }

  // Account for pending local deductions to keep UI consistent until sync
  let finalProducts = merged as Product[];
  try {
    const { getPendingDeductions, bulkAddProducts } = await import('@/lib/offlineDb');
    const pendingDeductions = await getPendingDeductions();

    finalProducts = merged.map(p => {
      const pendingQty = pendingDeductions[p.id] || 0;
      const newStock = (p.inStock || 0) - pendingQty;
      return {
        ...p,
        inStock: p.allowNegativeStock ? newStock : Math.max(0, newStock)
      };
    });

    // Replace only this shop's cache bucket with the complete catalog.
    await bulkAddProducts(finalProducts.map(p => ({ ...p as any, in_stock: p.inStock })), shopId);
  } catch (e) {
    console.warn('Sync products error:', e);
  }

  return finalProducts;
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

  if (!(await hasNetwork())) {
    console.warn('fetchDiscountPlans: offline (NetInfo) – using local cache');
    const { getDiscountPlans } = await import('@/lib/offlineDb');
    return await getDiscountPlans(shopId);
  }

  let query = supabase
    .from('discount_plans')
    .select('*')
    .eq('status', 'active');
  
  if (shopId) {
    query = query.or(`shop_id.eq.${shopId},shop_id.is.null`);
  }

  let data: any = null;
  try {
    const res = await withTimeout(query, NETWORK_TIMEOUT_MS);
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    console.warn('fetchDiscountPlans error – using local cache:', err);
    try {
      const { getDiscountPlans } = await import('@/lib/offlineDb');
      return await getDiscountPlans(shopId);
    } catch (cacheErr) {
      console.warn('offlineDb discount error:', cacheErr);
      return [];
    }
  }

  const results = (data ?? []) as DiscountPlan[];

  // Sync to local DB
  try {
    const { clearDiscountPlans, bulkSaveDiscountPlans } = await import('@/lib/offlineDb');
    await clearDiscountPlans();
    await bulkSaveDiscountPlans(results.map(p => ({ ...p, shop_id: shopId || '' } as any)));
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

  if (!(await hasNetwork())) {
    console.warn('fetchPricingPlans: offline (NetInfo) – using local cache');
    const { getPricingPlans } = await import('@/lib/offlineDb');
    return await getPricingPlans(shopId);
  }

  let query = supabase
    .from('pricing_plans')
    .select('*')
    .eq('status', 'active');
  
  if (shopId) {
    query = query.or(`shop_id.eq.${shopId},shop_id.is.null`);
  }

  let data: any = null;
  try {
    const res = await withTimeout(query, NETWORK_TIMEOUT_MS);
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    console.warn('fetchPricingPlans error – using local cache:', err);
    try {
      const { getPricingPlans } = await import('@/lib/offlineDb');
      return await getPricingPlans(shopId);
    } catch (cacheErr) {
      console.warn('offlineDb pricing error:', cacheErr);
      return [];
    }
  }

  const results = (data ?? []) as PricingPlan[];

  // Sync to local DB
  try {
    const { clearPricingPlans, bulkSavePricingPlans } = await import('@/lib/offlineDb');
    await clearPricingPlans();
    await bulkSavePricingPlans(results.map(p => ({ ...p, shop_id: shopId || '' } as any)));
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
  const { connectedDevice, status: printerStatus, printReceipt } = usePrinter();
  
  // SYNC NOTIFICATIONS - Buffered to prevent "Alert spam"
  useEffect(() => {
    let failureBuffer: any[] = [];
    let timeout: any = null;

    const showSummary = () => {
      if (failureBuffer.length === 0) return;
      
      const count = failureBuffer.length;
      const blockedCount = failureBuffer.filter(f => f.blocked).length;
      const uniqueItems = Array.from(new Set(failureBuffer.flatMap(f => f.items || []).map((i: any) => i.name)));
      const displayItems = uniqueItems.slice(0, 3).join(', ') + (uniqueItems.length > 3 ? '...' : '');

      if (blockedCount > 0) {
        Alert.alert(
          'Sales Blocked',
          `${count} sale(s) are blocked and will not sync until retried.\n\nProducts involved: ${displayItems}\n\nCommon Error: ${failureBuffer[0].error}\n\nTap "Retry Blocked" in the Sales Queue.`,
          [
            { text: 'View Queue', onPress: () => router.push('/sales') },
            { text: 'Dismiss', style: 'cancel' }
          ]
        );
      } else {
        Alert.alert(
          'Product Sync Failure',
          `${count} sale(s) failed to sync to the dashboard.\n\nProducts involved: ${displayItems}\n\nCommon Error: ${failureBuffer[0].error}\n\nPlease have an Admin check the Sales Queue.`,
          [
            { text: 'View Queue', onPress: () => router.push('/sales') },
            { text: 'Dismiss', style: 'cancel' }
          ]
        );
      }
      failureBuffer = [];
    };

    const pushFailure = (data: any) => {
      failureBuffer.push(data);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(showSummary, 1500); // Wait 1.5s for more failures before popping
    };

    const sub = DeviceEventEmitter.addListener('sync_failure', (data: any) => {
      pushFailure(data);
    });
    const blockedSub = DeviceEventEmitter.addListener('sale_blocked', (data: any) => {
      pushFailure({ ...data, blocked: true });
    });

    return () => {
      sub.remove();
      blockedSub.remove();
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // 1. RESPONSIVE UTILS
  const isTablet = width >= 768;
  const isMobile = width < 768;
  const scale = width / 1024;
  const s = useCallback((val: number) => Math.floor(Math.max(val * scale, val * 0.75)), [scale]);

  // 2. ALL STATES
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('USD Cash');
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const voidModalOpacity = useSharedValue(0);
  const voidModalScale = useSharedValue(0.85);
  const voidModalStyle = useAnimatedStyle(() => ({
    opacity: voidModalOpacity.value,
    transform: [{ scale: voidModalScale.value }],
  }));
  const voidBtnScale = useSharedValue(1);
  const voidBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: voidBtnScale.value }],
  }));
  const voidConfirmScale = useSharedValue(1);
  const voidConfirmStyle = useAnimatedStyle(() => ({
    transform: [{ scale: voidConfirmScale.value }],
  }));
  const clearModalOpacity = useSharedValue(0);
  const clearModalScale = useSharedValue(0.85);
  const clearModalStyle = useAnimatedStyle(() => ({
    opacity: clearModalOpacity.value,
    transform: [{ scale: clearModalScale.value }],
  }));
  const clearConfirmScale = useSharedValue(1);
  const clearConfirmStyle = useAnimatedStyle(() => ({
    transform: [{ scale: clearConfirmScale.value }],
  }));
  const [customerName, setCustomerName] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (showVoidConfirm) {
      voidModalOpacity.value = withTiming(1, { duration: 200 });
      voidModalScale.value = withSpring(1, { damping: 14, stiffness: 200 });
    } else {
      voidModalOpacity.value = withTiming(0, { duration: 150 });
      voidModalScale.value = withSpring(0.85, { damping: 14, stiffness: 200 });
    }
  }, [showVoidConfirm, voidModalOpacity, voidModalScale]);

  useEffect(() => {
    if (showClearConfirm) {
      clearModalOpacity.value = withTiming(1, { duration: 200 });
      clearModalScale.value = withSpring(1, { damping: 14, stiffness: 200 });
    } else {
      clearModalOpacity.value = withTiming(0, { duration: 150 });
      clearModalScale.value = withSpring(0.85, { damping: 14, stiffness: 200 });
    }
  }, [showClearConfirm, clearModalOpacity, clearModalScale]);

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
  // Fetches the receipt design for offline receipt printing (side effect: cache).
  useQuery({
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

  // Pure check: is a plan valid for the given date (Local timezone safe).
  // Date-scoped so it only changes at a day boundary, NOT every 30s — this lets
  // the heavy product/plan recompute below stay stable across clock ticks and
  // avoids freezing the UI (especially search) on slower tablets.
  const isValidForDate = useCallback((now: Date, start: string, end: string) => {
    // Force local date parsing by using slashes instead of dashes if it's YYYY-MM-DD
    const startStr = start.length === 10 ? start.replace(/-/g, '/') : start;
    const endStr = end.length === 10 ? end.replace(/-/g, '/') : end;

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (start.length === 10) startDate.setHours(0, 0, 0, 0);
    if (end.length === 10) endDate.setHours(23, 59, 59, 999);

    return now >= startDate && now <= endDate;
  }, []);

  // Collapse time to a day key so plan-date validity only re-evaluates when the
  // calendar date changes (midnight), not every 30-second clock tick.
  const dayKey = `${currentTime.getFullYear()}-${currentTime.getMonth()}-${currentTime.getDate()}`;

  // Cheap O(plans) prefilter of which plans are currently date-valid. Stable
  // across the day, so adjustedProducts (O(products x plans)) won't recompute
  // just because the clock moved.
  const validPricingPlans = useMemo(() => {
    const now = new Date();
    return activePricingPlans.filter(p => p.status === 'active' && isValidForDate(now, p.start_date, p.end_date));
    // dayKey in deps is an intentional time-boundary for correctness; eslint-safe name kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePricingPlans, isValidForDate, dayKey]);

  const validDiscountPlans = useMemo(() => {
    const now = new Date();
    return activeDiscountPlans.filter(p => p.status === 'active' && isValidForDate(now, p.start_date, p.end_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiscountPlans, isValidForDate, dayKey]);

  const adjustedProducts = useMemo(() => {
    // Pre-group plans to avoid filtering them for every single product.
    // Plans are already prefiltered by date (validPricingPlans etc.), so we
    // don't re-check dates here — this keeps the expensive product map loop
    // stable across clock ticks.
    const pricingPlansByType = {
      all: [] as PricingPlan[],
      product: {} as Record<string, PricingPlan[]>,
      category: {} as Record<string, PricingPlan[]>,
    };

    validPricingPlans.forEach(plan => {
      if (plan.applicable_to === 'all') {
        pricingPlansByType.all.push(plan);
      } else if (plan.applicable_to === 'product') {
        const key = plan.target_id || normalize(plan.target_name || '');
        if (!pricingPlansByType.product[key]) pricingPlansByType.product[key] = [];
        pricingPlansByType.product[key].push(plan);
      } else if (plan.applicable_to === 'category') {
        const key = normalize(plan.target_name || '');
        if (!pricingPlansByType.category[key]) pricingPlansByType.category[key] = [];
        pricingPlansByType.category[key].push(plan);
      }
    });

    const discountPlansByType = {
      all: [] as DiscountPlan[],
      product: {} as Record<string, DiscountPlan[]>,
      category: {} as Record<string, DiscountPlan[]>,
    };

    validDiscountPlans.forEach(plan => {
      if (plan.applicable_to === 'all') {
        discountPlansByType.all.push(plan);
      } else if (plan.applicable_to === 'product') {
        const key = plan.target_id || normalize(plan.target_name || '');
        if (!discountPlansByType.product[key]) discountPlansByType.product[key] = [];
        discountPlansByType.product[key].push(plan);
      } else if (plan.applicable_to === 'category') {
        const key = normalize(plan.target_name || '');
        if (!discountPlansByType.category[key]) discountPlansByType.category[key] = [];
        discountPlansByType.category[key].push(plan);
      }
    });

    return products.map(p => {
      const targetName = normalize(p.name);
      const productCategory = normalize(p.category || '');

      // 1. Evaluate Pricing Plans
      const applicablePricing = [
        ...pricingPlansByType.all,
        ...(pricingPlansByType.product[p.id] || []),
        ...(pricingPlansByType.product[targetName] || []),
        ...(pricingPlansByType.category[productCategory] || []),
      ];

      let priceFromPricing = p.price;
      if (applicablePricing.length > 0) {
        let bestMult = 1;
        let set = false;
        applicablePricing.forEach(plan => {
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

      // 2. Evaluate Discount Plans
      const applicableDiscounts = [
        ...discountPlansByType.all,
        ...(discountPlansByType.product[p.id] || []),
        ...(discountPlansByType.product[targetName] || []),
        ...(discountPlansByType.category[productCategory] || []),
      ];

      let priceFromDiscount = p.price;
      if (applicableDiscounts.length > 0) {
        let lowestPrice = p.price;
        applicableDiscounts.forEach(plan => {
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

      const finalPrice = Math.round(Math.min(priceFromPricing, priceFromDiscount) * 100) / 100;

      return {
        ...p,
        price: finalPrice,
        originalPrice: p.price,
        isAdjusted: finalPrice !== p.price
      };
    });
  }, [products, validPricingPlans, validDiscountPlans]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    adjustedProducts.forEach(p => { 
      if (p.category) {
        // Normalize to UPPERCASE to avoid duplicates like "Bakery" vs "BAKERY"
        cats.add(p.category.trim().toUpperCase());
      }
    });
    return ['All', ...Array.from(cats).sort()];
  }, [adjustedProducts]);

  // Debounced from SearchBar; parent only re-renders when the term settles.
  const handleSearch = useCallback((text: string) => {
    setSearchTerm(text.trim().toLowerCase());
  }, []);

  const filteredProducts = useMemo(() => {
    return adjustedProducts.filter(p => {
      const pCat = p.category ? p.category.trim().toUpperCase() : '';
      const matchCat = selectedCategory === 'All' || pCat === selectedCategory;
      const matchSearch =
        searchTerm.length === 0 ||
        p.name.toLowerCase().includes(searchTerm) ||
        (p.sku ?? '').toLowerCase().includes(searchTerm);
      return matchCat && matchSearch;
    });
  }, [adjustedProducts, searchTerm, selectedCategory]);

  const autoDiscountTotal = useMemo(() => {
    let totalDisc = 0;
    if (validDiscountPlans.length === 0 || items.length === 0) return 0;

    items.forEach(item => {
      // Use the potentially adjusted product price from adjustedProducts
      const productInList = adjustedProducts.find(p => p.id === item.product.id);
      const currentPrice = productInList?.price || item.product.price;

      // Find plans applicable to this specific product OR its category OR 'all'
      // (validDiscountPlans is already filtered by status + date).
      const applicablePlans = validDiscountPlans.filter(plan => {
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
  }, [items, validDiscountPlans, adjustedProducts]);

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

    // Debounce realtime-driven refetches so bursts of stock changes (e.g. a
    // sale on a second tablet using the same shop) coalesce into a single
    // refetch instead of triggering a full-catalog redownload every event.
    const debouncedInvalidate = (() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let queued: { key: readonly unknown[]; }[] = [];
      const flush = () => {
        const keys = queued;
        timer = null;
        queued = [];
        for (const q of keys) {
          queryClient.invalidateQueries({ queryKey: q.key as any });
        }
      };
      return (key: readonly unknown[]) => {
        if (!queued.some(q => JSON.stringify(q.key) === JSON.stringify(key))) {
          queued.push({ key });
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 800);
      };
    })();

    const prodChannel = supabase
      .channel('inventory_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        debouncedInvalidate(['supabase-products', shopId]);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'product_shop_stock',
        filter: shopId ? `shop_id=eq.${shopId}` : undefined
      }, async () => {
        debouncedInvalidate(['supabase-products', shopId]);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'discount_plans'
      }, async () => {
        debouncedInvalidate(['discount-plans', shopId]);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pricing_plans'
      }, async () => {
        debouncedInvalidate(['pricing-plans', shopId]);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'receipt_designs'
      }, async () => {
        debouncedInvalidate(['receipt-design', shopId]);
      })
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(prodChannel);
    };
  }, [queryClient, shopId]);

  const handleCharge = async () => {
    if (items.length === 0 || isCharging) return;
    setIsCharging(true);
    if (!shopId) {
      Alert.alert('Missing shop ID', 'Please set your shop/terminal in Settings before charging.');
      setIsCharging(false);
      return;
    }

    // Validate total is positive — prevents negative or zero sales from being recorded
    if (grandTotal <= 0) {
      Alert.alert('Invalid Total', 'The sale total must be greater than zero. Check your discount amount.');
      setIsCharging(false);
      return;
    }

    const outOfStock = items.filter(i => (i.product.inStock ?? 0) <= 0 && !i.product.allowNegativeStock);
    if (outOfStock.length > 0) {
      const names = outOfStock.map(i => i.product.name).join(', ');
      Alert.alert('Out of Stock', `Cannot complete sale — the following item(s) have no stock: ${names}`);
      setIsCharging(false);
      return;
    }

    let didScheduleReset = false;

    try {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Use robust UUID-style ID to prevent collisions on rapid taps
      const { generateSaleId } = await import('@/lib/offlineDb');
      const orderId = generateSaleId();

      const receiptItems = items.map(i => ({
        product_id: i.product.id,
        name: i.product.name,
        quantity: i.quantity,
        price: i.product.price,
        originalPrice: (i.product as any).originalPrice ?? i.product.price,
        category: i.product.category || 'Uncategorized',
      }));

      const saleRecord: any = {
        orderId,
        items: receiptItems,
        subtotal: total,
        discount: manualDiscountAmount,
        autoSavings: autoDiscountTotal,
        tax: 0,
        total: grandTotal,
        createdAt: new Date().toISOString(),
        shopId,
        customerName: customerName.trim() || null,
        paymentMethod: selectedPaymentMethod,
        employeeId: employee?.employee_id || null,
        employeeName: employee ? `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() : null,
      };

      // Step 1: Atomically queue the sale + deduct stock in a single transaction
      //         If either fails, both are rolled back — no inconsistent state.
      let saleQueued = false;
      try {
        const { queueSaleAtomically } = await import('@/lib/offlineDb');
        await queueSaleAtomically(saleRecord, receiptItems);
        saleQueued = true;

        // COMMIT POINT: the sale is durably recorded in the local ledger.
        // Clear the cart immediately so a crash/restart in the next moments
        // cannot cause the same items to be re-rung as a duplicate sale.
        clearCart();

        // OPTIMISTIC UPDATE: Update the local cache immediately so the UI reflects the change
        queryClient.setQueryData(['supabase-products', shopId], (old: Product[] | undefined) => {
          if (!old) return old;
          return old.map(p => {
            const soldItem = receiptItems.find(i => i.product_id === p.id);
            if (soldItem) {
              const newStock = (p.inStock || 0) - soldItem.quantity;
              return { ...p, inStock: p.allowNegativeStock ? newStock : Math.max(0, newStock) };
            }
            return p;
          });
        });
        
        refreshPending();
      } catch (e) {
        console.warn('failed to queue sale atomically', e);
        if (!saleQueued) {
          // Sale was never saved — alert the cashier and abort
          Alert.alert('Sale Failed', 'Could not save the sale. Please try again.');
          return;  // finally block will reset isCharging
        }
      }

      // Step 2: Trigger background sync (fire-and-forget, non-blocking)
      if (supabase && shopId) {
        import('@/lib/sync').then(({ syncSalesQueue }) => syncSalesQueue()).catch(() => {});
      }

      // Step 3: Log activity (non-critical, wrapped in try/catch)
      try {
        const { logActivity } = await import('@/lib/activityLogger');
        await logActivity('sale_complete', employee?.employee_id || null, {
          amount: grandTotal,
          discount: manualDiscountAmount + autoDiscountTotal,
          order_id: orderId
        });
      } catch (e) {
        console.warn('[POS] Activity logging failed (non-critical):', e);
      }

      // Step 4: Print receipt (non-critical)
      try {
        const success = await printReceipt({
          orderId: saleRecord.orderId,
          items: saleRecord.items.map((i: any) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price,
          })),
          subtotal: saleRecord.subtotal,
          discount: saleRecord.discount,
          total: saleRecord.total,
          createdAt: saleRecord.createdAt,
          paymentMethod: selectedPaymentMethod,
          employeeName: employee
            ? `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim()
            : 'Staff',
          // shopId is injected by BluetoothContext.printReceipt automatically
        });

        if (!success && printerStatus === 'connected') {
          Alert.alert(
            'Printer Error',
            'Sale was saved successfully, but the receipt could not be printed.\nCheck your printer in Settings.',
            [{ text: 'OK' }]
          );
        }
      } catch (e) {
        console.warn('[POS] Silent print failed:', e);
      }

      // Step 5: Show success and clear transient fields.
      //         NOTE: cart was already cleared at the commit point above.
      setOrderSuccess(true);
      didScheduleReset = true;
      setTimeout(() => {
        setCustomerName('');
        setOrderSuccess(false);
        setIsCharging(false);
      }, 1800);
    } finally {
      // Safety net: if we never reached the setTimeout (due to any throw or early return),
      // ensure the button is always unlocked so the cashier isn't stuck.
      if (!didScheduleReset) {
        setIsCharging(false);
      }
    }
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
            {pendingCount > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
              </View>
            )}
          </Pressable>

          <SearchBar onSearch={handleSearch} styles={styles} s={s} />
        </View>
        <View style={styles.topBarRight}>
          <MessageNotificationsBell shopId={shopId} iconSize={s(20)} />
          {pendingCount > 0 && (
            <Pressable 
              style={[styles.topBarIconBtn, { backgroundColor: C.warningDim }]} 
              onPress={() => router.push('/sales')}
            >
              <MaterialCommunityIcons name="cloud-sync-outline" size={s(20)} color={C.warning} />
            </Pressable>
          )}
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
            <View style={{ position: 'relative' }}>
              <SidebarItem icon="cart-outline" label="Sales Queued" onPress={() => { setSidebarOpen(false); router.push('/sales'); }} styles={styles} s={s} />
              {pendingCount > 0 && (
                <View style={[styles.pendingBadge, { right: 16, top: 12 }]}>
                  <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </View>
            {employee?.role === 'Admin' && (
              <>
                <SidebarItem 
                  icon="chart-bar" 
                  label="Reports" 
                  onPress={() => { setSidebarOpen(false); router.push('/reports'); }}
                  styles={styles} 
                  s={s} 
                />
                <SidebarItem icon="account-multiple-outline" label="Customers" styles={styles} s={s} />
              </>
            )}
            <SidebarItem
              icon="message-alert-outline"
              label="Messages"
              onPress={() => { setSidebarOpen(false); router.push('/messages'); }}
              styles={styles}
              s={s}
            />
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
              initialNumToRender={isTablet ? 20 : 10}
              maxToRenderPerBatch={isTablet ? 20 : 10}
              windowSize={isTablet ? 7 : 5}
              removeClippedSubviews={Platform.OS !== 'web'}
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
                <Pressable style={styles.clearRow} onPress={() => {
                  setShowClearConfirm(true);
                  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}>
                  <Feather name="trash-2" size={s(13)} color={C.danger} />
                  <Text style={styles.clearRowText}>Clear</Text>
                </Pressable>
                <Animated.View style={voidBtnStyle}>
                  <Pressable
                    style={styles.voidBtn}
                    onPress={() => setShowVoidConfirm(true)}
                    onPressIn={() => { voidBtnScale.value = withSpring(0.92, { damping: 16, stiffness: 260 }); }}
                    onPressOut={() => { voidBtnScale.value = withSpring(1, { damping: 12, stiffness: 200 }); }}
                  >
                    <Text style={styles.voidBtnText}>VOID</Text>
                  </Pressable>
                </Animated.View>
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

            {printerStatus === 'connected' && connectedDevice && (
              <View style={styles.printerBadge}>
                <MaterialCommunityIcons name="printer-check" size={s(11)} color={C.success} />
                <Text style={styles.printerBadgeText}>{connectedDevice.name}</Text>
              </View>
            )}

            {printerStatus === 'failed' && (
              <View style={[styles.printerBadge, { backgroundColor: C.dangerDim, borderColor: C.danger }]}>
                <MaterialCommunityIcons name="printer-alert" size={s(11)} color={C.danger} />
                <Text style={[styles.printerBadgeText, { color: C.danger }]}>Printer Error</Text>
              </View>
            )}

            {printerStatus === 'bluetooth_off' && (
              <View style={[styles.printerBadge, { backgroundColor: C.warningDim, borderColor: C.warning || C.accent }]}>
                <MaterialCommunityIcons name="bluetooth-off" size={s(11)} color={C.warning || C.accent} />
                <Text style={[styles.printerBadgeText, { color: C.warning || C.accent }]}>Bluetooth Off</Text>
              </View>
            )}

            {(!connectedDevice || (printerStatus !== 'connected' && printerStatus !== 'failed' && printerStatus !== 'bluetooth_off')) && (
              <View style={[styles.printerBadge, { backgroundColor: C.textMuted + '20', borderColor: C.textMuted }]}>
                <MaterialCommunityIcons name="printer-off" size={s(11)} color={C.textMuted} />
                <Text style={[styles.printerBadgeText, { color: C.textMuted }]}>No Printer</Text>
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

              <Modal
                visible={showVoidConfirm}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowVoidConfirm(false)}
              >
                <Pressable
                  style={styles.modalOverlay}
                  onPress={() => setShowVoidConfirm(false)}
                >
                  <Animated.View style={[styles.voidModal, voidModalStyle]}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={s(40)} color={C.danger} />
                    <Text style={styles.voidModalTitle}>Void Transaction?</Text>
                    <Text style={styles.voidModalBody}>
                      This will void the current transaction and remove all {itemCount} item(s) from the cart (total {grandTotal.toFixed(2)}). This cannot be undone.
                    </Text>
                    <View style={styles.voidModalBtns}>
                      <Pressable
                        style={[styles.voidModalBtn, styles.voidModalCancelBtn]}
                        onPress={() => setShowVoidConfirm(false)}
                      >
                        <Text style={styles.voidModalCancelText}>Cancel</Text>
                      </Pressable>
                      <Animated.View style={[styles.voidModalBtn, voidConfirmStyle]}>
                        <Pressable
                          style={[styles.voidModalFillBtn, styles.voidModalConfirmBtn]}
                          onPress={async () => {
                            setShowVoidConfirm(false);
                            const { logActivity } = await import('@/lib/activityLogger');
                            await logActivity('transaction_void', employee?.employee_id || null, { amount: grandTotal });
                            clearCart();
                            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                          }}
                          onPressIn={() => { voidConfirmScale.value = withSpring(0.94, { damping: 16, stiffness: 260 }); }}
                          onPressOut={() => { voidConfirmScale.value = withSpring(1, { damping: 12, stiffness: 200 }); }}
                        >
                          <Text style={styles.voidModalConfirmText}>Void</Text>
                        </Pressable>
                      </Animated.View>
                    </View>
                  </Animated.View>
                </Pressable>
              </Modal>

              <Modal
                visible={showClearConfirm}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowClearConfirm(false)}
              >
                <Pressable
                  style={styles.modalOverlay}
                  onPress={() => setShowClearConfirm(false)}
                >
                  <Animated.View style={[styles.voidModal, clearModalStyle]}>
                    <MaterialCommunityIcons name="trash-can-outline" size={s(40)} color={C.danger} />
                    <Text style={styles.voidModalTitle}>Clear Cart?</Text>
                    <Text style={styles.voidModalBody}>
                      This will remove all {itemCount} item(s) from the cart (total {grandTotal.toFixed(2)}). This cannot be undone.
                    </Text>
                    <View style={styles.voidModalBtns}>
                      <Pressable
                        style={[styles.voidModalBtn, styles.voidModalCancelBtn]}
                        onPress={() => setShowClearConfirm(false)}
                      >
                        <Text style={styles.voidModalCancelText}>Keep Items</Text>
                      </Pressable>
                      <Animated.View style={[styles.voidModalBtn, clearConfirmStyle]}>
                        <Pressable
                          style={[styles.voidModalFillBtn, styles.voidModalConfirmBtn]}
                          onPress={async () => {
                            setShowClearConfirm(false);
                            const { logActivity } = await import('@/lib/activityLogger');
                            await logActivity('transaction_cancelled', employee?.employee_id || null);
                            clearCart();
                          }}
                          onPressIn={() => { clearConfirmScale.value = withSpring(0.94, { damping: 16, stiffness: 260 }); }}
                          onPressOut={() => { clearConfirmScale.value = withSpring(1, { damping: 12, stiffness: 200 }); }}
                        >
                          <Text style={styles.voidModalConfirmText}>Clear</Text>
                        </Pressable>
                      </Animated.View>
                    </View>
                  </Animated.View>
                </Pressable>
              </Modal>

              <Pressable
                style={[
                  styles.chargeBtn,
                  (items.length === 0 || isCharging) && styles.chargeBtnDisabled,
                  (!shopId && items.length > 0) && { opacity: 0.8 }, // Slight fade if shopId missing but items present
                  orderSuccess && styles.chargeBtnSuccess,
                ]}
                onPress={handleCharge}
                disabled={items.length === 0 || isCharging}
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

/**
 * Self-contained search input. Keeps its text in LOCAL state so each keystroke
 * only re-renders this tiny component, never the whole POS screen. The parent
 * receives a debounced, already-lowercased term via onSearch.
 */
const SearchBar = React.memo(({ onSearch, styles, s }: {
  onSearch: (text: string) => void;
  styles: any;
  s: any;
}) => {
  const [text, setText] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(value), 250);
  };

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setText('');
    onSearch('');
  };

  return (
    <View style={styles.searchBox}>
      <Feather name="search" size={s(16)} color={C.textSecondary} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search products..."
        placeholderTextColor={C.textMuted}
        value={text}
        onChangeText={handleChange}
      />
      {text.length > 0 && (
        <Pressable onPress={handleClear}>
          <Feather name="x" size={s(14)} color={C.textSecondary} />
        </Pressable>
      )}
    </View>
  );
});
SearchBar.displayName = 'SearchBar';

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

const ProductCard = React.memo(({ product, onPress, styles, s }: { product: Product; onPress: (p: Product) => void; styles: any; s: any }) => {
  const isOutOfStock = !product.allowNegativeStock && (product.inStock ?? 0) <= 0;
  const isNegative = product.allowNegativeStock && (product.inStock ?? 0) < 0;
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
        ) : isNegative ? (
          <View style={[styles.lowStockOverlay, { backgroundColor: 'rgba(220,50,50,0.85)' }]}>
            <Text style={styles.lowStockText}>{product.inStock}</Text>
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
}, (prev, next) => {
  return (
    prev.product.id === next.product.id &&
    prev.product.price === next.product.price &&
    prev.product.inStock === next.product.inStock &&
    prev.product.name === next.product.name &&
    prev.product.image_url === next.product.image_url
  );
});
ProductCard.displayName = 'ProductCard';

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
  voidModal: {
    width: '82%',
    maxWidth: s(340),
    backgroundColor: C.surface,
    borderRadius: s(16),
    padding: s(20),
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  voidModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(18),
    color: C.text,
    marginTop: s(12),
    textAlign: 'center',
  },
  voidModalBody: {
    fontFamily: 'Inter_500Medium',
    fontSize: s(14),
    color: C.textSecondary,
    marginTop: s(10),
    marginBottom: s(20),
    textAlign: 'center',
    lineHeight: s(20),
  },
  voidModalBtns: {
    flexDirection: 'row',
    width: '100%',
    gap: s(10),
  },
  voidModalBtn: {
    flex: 1,
    alignItems: 'stretch',
  },
  voidModalFillBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(12),
    borderRadius: s(10),
  },
  voidModalCancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: s(10),
    paddingVertical: s(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  voidModalConfirmBtn: {
    backgroundColor: C.danger,
  },
  voidModalCancelText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(14),
    color: C.text,
  },
  voidModalConfirmText: {
    fontFamily: 'Inter_700Bold',
    fontSize: s(14),
    color: '#fff',
  },
});
