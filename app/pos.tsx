import React, { useState, useMemo, useEffect } from 'react';
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
import * as Print from 'expo-print';
import { generateReceiptHtml } from '@/lib/receiptHtml';
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
import { Product } from '@/data/products';
import Colors from '@/constants/colors';

const C = Colors.dark;

// retail-only, order types removed

async function fetchProductsFromSupabase(shopId: string | null): Promise<Product[]> {
  console.log('fetchProductsFromSupabase called, shopId:', shopId, 'supabase client:', supabase);
  if (!supabase) {
    console.warn('fetchProducts: supabase client missing – using local cache');
    // no network client; fall back to local cache (mutable during development)
    try {
      const { getProducts } = await import('@/lib/offlineDb');
      const local = await getProducts();
      // convert ProductRecord -> Product shape
      return local.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category || '',
        image_url: p.image_url || '',
      }));
    } catch (_e) {
      return [];
    }
  }

  // Fetch products and their shop-specific stock/price if shopId is provided
  let query = supabase.from('products').select('*, product_shop_stock(price, in_stock, available)');

  if (shopId) {
    query = query.eq('product_shop_stock.shop_id', shopId);
  }

  const { data, error } = await query.order('name', { ascending: true });
  console.log('fetchProductsFromSupabase →', data, error);
  if (error) {
    // try local fallback on fetch error
    try {
      const { getProducts } = await import('@/lib/offlineDb');
      const local = await getProducts();
      return local.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        category: p.category || '',
        image_url: p.image_url || '',
      }));
    } catch (_err) {
      throw new Error(error.message);
    }
  }

  const merged = (data ?? []).map((p: any) => {
    const shopData = p.product_shop_stock && p.product_shop_stock.length > 0 ? p.product_shop_stock[0] : null;
    return {
      id: p.id,
      name: p.name,
      // Use shop-specific price if available, otherwise base price
      price: shopData && shopData.price !== null ? Number(shopData.price) : Number(p.price),
      category: p.category,
      image_url: p.image_url,
      sku: p.code || p.sku,
      inStock: shopData ? Number(shopData.in_stock ?? 0) : 0,
    };
  });

  return merged as Product[];
}

export default function POSScreen() {
  const { logout, employee } = useAuth();
  const { items, addItem, removeItem, updateQuantity, clearCart, total } = useCart();
  const { connectedDevice, status: btStatus } = useBluetooth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const numColumns = width < 768 ? 2 : width < 1200 ? 4 : 5;

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [orderSuccess, setOrderSuccess] = useState(false);
  // orderType removed for retail use
  const [discount, setDiscount] = useState('0');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // shop/terminal id pulled from settings; used to guard charge & rpc calls
  const [shopId, setShopId] = useState<string | null>(null);
  useEffect(() => {
    import('@/lib/settings').then(({ getPosId }) => {
      getPosId().then(id => setShopId(id));
    });
  }, []);

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

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('USD Cash');
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [customerName, setCustomerName] = useState('');

  useEffect(() => {
    if (paymentMethods.length > 0 && !paymentMethods.find(m => m.payment_type_name === selectedPaymentMethod)) {
      setSelectedPaymentMethod(paymentMethods[0].payment_type_name);
    }
  }, [paymentMethods]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        refetch();
        refreshPending();
      }
    });
    return () => subscription.remove();
  }, []);

  const {
    data: products = [],
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery<Product[]>({
    queryKey: ['supabase-products', shopId],
    queryFn: () => fetchProductsFromSupabase(shopId),
  });


  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    return ['All', ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [products, search, selectedCategory]);

  const discountAmount = parseFloat(discount) || 0;
  const taxAmount = 0; // tax removed — total equals raw item subtotal minus discount
  const grandTotal = total - discountAmount;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  // Sync products to local database whenever they are updated from Supabase
  useEffect(() => {
    if (products.length > 0) {
      import('@/lib/offlineDb').then(async ({ addProduct }) => {
        for (const p of products) {
          try {
            await addProduct({
              id: p.id,
              name: p.name,
              price: p.price,
              category: p.category,
              image_url: p.image_url,
            });
          } catch (err) {
            console.warn('Failed to sync product to local DB', p.id, err);
          }
        }
      });
    }
  }, [products]);

  const [pendingCount, setPendingCount] = useState(0);
  const refreshPending = async () => {
    const { getPendingSales } = await import('@/lib/offlineDb');
    const list = await getPendingSales();
    setPendingCount(list.length);
  };

  useEffect(() => {
    refreshPending();
  }, []);

  // listen for receipts coming back from Supabase; the server
  // or another terminal may insert rows and we want to print them
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('receipt_printer')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transaction_receipts' },
        async (payload: any) => {
          try {
            const row = payload.new as Record<string, any>;
            const html = generateReceiptHtml({
              orderId: row.order_id ?? row.id,
              orderType: row.order_type ?? 'Dine In',
              items: Array.isArray(row.items) ? row.items : [],
              subtotal: Number(row.subtotal ?? 0),
              discount: Number(row.discount ?? 0),
              tax: Number(row.tax ?? 0),
              total: Number(row.total ?? 0),
              createdAt: row.created_at ?? new Date().toISOString(),
            });
            await Print.printAsync({ html });
          } catch (_) { }
        }
      )
      .subscribe();
    return () => { if (supabase) supabase.removeChannel(channel); };
  }, []);

  // subscribe to product changes so the grid updates automatically
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!supabase) {
      console.warn('realtime listener aborted because supabase is null');
      return;
    }
    console.log('creating realtime subscription to products and shop stock');

    const prodChannel = supabase
      .channel('products_listener')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async (payload) => {
        console.log('product change payload', payload);
        queryClient.invalidateQueries({ queryKey: ['supabase-products', shopId] });
        const eventType = (payload as any).eventType;
        if (eventType !== 'DELETE') {
          try {
            const { addProduct } = await import('@/lib/offlineDb');
            // Logic for manual add if needed
          } catch { }
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'product_shop_stock',
        filter: shopId ? `shop_id=eq.${shopId}` : undefined
      }, async (payload) => {
        console.log('product_shop_stock change payload', payload);
        queryClient.invalidateQueries({ queryKey: ['supabase-products', shopId] });
      })
      .subscribe();

    return () => {
      if (supabase) {
        supabase.removeChannel(prodChannel);
      }
    };
  }, [queryClient, shopId]);

  const handleLogout = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
    router.replace('/');
  };

  const handleCharge = async () => {
    if (items.length === 0) return;

    // require a saved shop/terminal id
    if (!shopId) {
      Alert.alert('Missing shop ID', 'Please set your shop/terminal in Settings before charging.');
      return;
    }

    // block sale if any cart item is out of stock
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

    const saleRecord: any = {
      orderId,
      items: receiptItems,
      subtotal: total,
      discount: discountAmount,
      tax: 0,
      total: grandTotal,
      createdAt: new Date().toISOString(),
      shopId,
      customerName: customerName.trim() || null,
    };

    // Always queue the sale locally for offline support
    try {
      const { queueSale } = await import('@/lib/offlineDb');
      await queueSale(saleRecord);
      refreshPending();
    } catch (e) {
      console.warn('failed to queue sale', e);
    }

    // When online, call the dedicated RPC to deduct stock immediately
    if (supabase && shopId) {
      try {
        await supabase.rpc('handle_pos_sale', {
          p_shop_id: shopId,
          p_items: receiptItems,
          p_order_id: orderId,
          p_total_amount: Number(grandTotal),
          p_payment_method: selectedPaymentMethod,
          p_employee_id: employee?.employee_id ?? null,
          p_customer_name: customerName.trim() || null,
        });
      } catch (e) {
        console.warn('pos_sale RPC error', e);
      }
    } else if (!shopId) {
      console.warn('Cannot deduct stock: shopId is missing');
    }

    // still sync queued records for redundancy
    import('@/lib/sync').then(({ syncSalesQueue }) => syncSalesQueue());

    setOrderSuccess(true);
    setTimeout(() => {
      clearCart();
      setCustomerName('');
      setOrderSuccess(false);
    }, 1800);
  };


  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable style={styles.topBarIconBtn} onPress={() => setSidebarOpen(v => !v)}>
            <Ionicons name="menu" size={22} color={C.text} />
          </Pressable>
          <View style={styles.pageSelector}>
            <Text style={styles.pageSelectorText}>PAGE 1</Text>
            <MaterialIcons name="arrow-drop-down" size={20} color={C.textSecondary} />
          </View>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={C.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Feather name="x" size={14} color={C.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.topBarRight}>
          <Pressable style={styles.topBarIconBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={20} color={C.textSecondary} />
          </Pressable>
          <Pressable style={styles.topBarIconBtn} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {sidebarOpen && (
        <Pressable style={styles.sidebarOverlay} onPress={() => setSidebarOpen(false)}>
          <View style={styles.sidebarDropdown}>
            <SidebarItem icon="view-grid-outline" label="Products" active />
            <SidebarItem icon="cart-outline" label="Sales" onPress={() => { setSidebarOpen(false); router.push('/sales'); }} />
            <SidebarItem icon="chart-bar" label="Reports" />
            <SidebarItem icon="account-multiple-outline" label="Customers" />
            <SidebarItem
              icon="cog-outline"
              label="Settings"
              onPress={() => { setSidebarOpen(false); router.push('/settings'); }}
            />
            <View style={styles.sidebarDivider} />
            <SidebarItem icon="logout" label="Logout" danger onPress={handleLogout} />
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
              <MaterialCommunityIcons name="alert-circle-outline" size={44} color={C.danger} />
              <Text style={styles.stateText}>Failed to load products</Text>
              <Text style={styles.stateSubText}>{(fetchError as Error).message}</Text>
              <Pressable style={styles.retryBtn} onPress={() => refetch()}>
                <Feather name="refresh-cw" size={14} color={C.accent} />
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
                <ProductCard product={item} onPress={addItem} />
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Feather name="package" size={36} color={C.textMuted} />
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
                />
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={[styles.cartPanel, { paddingBottom: botPad }]}>


          {items.length === 0 ? (
            <View style={styles.cartEmpty}>
              <MaterialCommunityIcons name="cart-outline" size={40} color={C.textMuted} />
              <Text style={styles.cartEmptyText}>No items added</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => String(i.product.id)}
              showsVerticalScrollIndicator={false}
              style={styles.cartList}
              renderItem={({ item }) => (
                <CartRow item={item} onUpdate={updateQuantity} onRemove={removeItem} />
              )}
            />
          )}

          <View style={styles.cartFooter}>
            <View style={styles.customerInputRow}>
              <Ionicons name="person-outline" size={16} color={C.textSecondary} />
              <TextInput
                style={styles.customerInput}
                placeholder="Review Customer Name..."
                placeholderTextColor={C.textMuted}
                value={customerName}
                onChangeText={setCustomerName}
              />
              {customerName.length > 0 && (
                <Pressable onPress={() => setCustomerName('')}>
                  <Feather name="x" size={14} color={C.textSecondary} />
                </Pressable>
              )}
            </View>

            {items.length > 0 && (
              <Pressable style={styles.clearRow} onPress={clearCart}>
                <Feather name="trash-2" size={13} color={C.danger} />
                <Text style={styles.clearRowText}>Clear order</Text>
              </Pressable>
            )}
            {items.length > 0 && (
              <Pressable style={styles.voidBtn} onPress={() => { clearCart(); if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }}>
                <Text style={styles.voidBtnText}>VOID</Text>
              </Pressable>
            )}

            <View style={styles.totalsBox}>
              <TotalRow label="Sub Total (USD)" value={total.toFixed(2)} />
              <View style={styles.discountRow}>
                <Text style={styles.totalLabelText}>Discount (USD)</Text>
                <TextInput
                  style={styles.discountInput}
                  value={discount}
                  onChangeText={setDiscount}
                  keyboardType="numeric"
                  selectTextOnFocus
                />
              </View>

              <View style={styles.totalsLine} />
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Total (USD)</Text>
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
                <MaterialCommunityIcons name="printer-check" size={11} color={C.success} />
                <Text style={styles.printerBadgeText}>{connectedDevice.name}</Text>
              </View>
            )}
            {pendingCount > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
              </View>
            )}

            <View style={styles.actionBtns}>
              <Pressable
                style={styles.paymentSelector}
                onPress={() => setShowPaymentPicker(true)}
              >
                <View style={styles.paymentSelectorLeft}>
                  <Text style={styles.paymentSelectorLabel}>PAYMENT</Text>
                  <Text style={styles.paymentSelectorValue}>{selectedPaymentMethod}</Text>
                </View>
                <MaterialIcons name="arrow-drop-down" size={20} color={C.textSecondary} />
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
                    <Text style={styles.pickerTitle}>Select Payment Method</Text>
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
                            <Ionicons name="checkmark-circle" size={18} color={C.accent} />
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
                  {orderSuccess ? 'DONE!' : 'CHARGE'}
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
}: {
  icon: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={[styles.sidebarItem, active && styles.sidebarItemActive]} onPress={onPress}>
      <MaterialCommunityIcons
        name={icon as any}
        size={20}
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

function CategoryTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
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

function ProductCard({ product, onPress }: { product: Product; onPress: (p: Product) => void }) {
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
            <Text style={styles.outOfStockText}>OUT OF STOCK</Text>
          </View>
        ) : (product.inStock ?? 0) < 10 && (
          <View style={styles.lowStockOverlay}>
            <Text style={styles.lowStockText}>LOW STOCK ({product.inStock})</Text>
          </View>
        )}
        <View style={styles.productInfo}>
          {!!product.category && (
            <Text style={styles.productCategory} numberOfLines={1}>{product.category}</Text>
          )}
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <View style={styles.productPriceRow}>
            <Text style={styles.productPrice}>
              USD {typeof product.price === 'number' ? product.price.toFixed(2) : product.price}
            </Text>
            <Pressable
              style={[styles.addBtn, isOutOfStock && styles.addBtnDisabled]}
              onPress={handlePress}
              disabled={isOutOfStock}
            >
              <Feather name="plus" size={13} color="#fff" />
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
}: {
  item: CartItem;
  onUpdate: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}) {
  const subtotal = item.product.price * item.quantity;
  return (
    <View style={styles.cartRow}>
      <Text style={styles.cartItemQty}>{item.quantity}x</Text>
      <Text style={styles.cartItemName} numberOfLines={1}>{item.product.name}</Text>
      <Text style={styles.cartItemPrice}>{subtotal.toFixed(2)}</Text>
      <View style={styles.cartRowActions}>
        <Pressable style={styles.qtyMiniBtn} onPress={() => onUpdate(String(item.product.id), item.quantity - 1)}>
          <Feather name="minus" size={11} color={C.text} />
        </Pressable>
        <Pressable style={styles.qtyMiniBtn} onPress={() => onUpdate(String(item.product.id), item.quantity + 1)}>
          <Feather name="plus" size={11} color={C.text} />
        </Pressable>
        <Pressable style={styles.removeMiniBtn} onPress={() => onRemove(String(item.product.id))}>
          <Feather name="x" size={11} color={C.danger} />
        </Pressable>
      </View>
    </View>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabelText}>{label}</Text>
      <Text style={styles.totalValueText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    zIndex: 10,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topBarIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  pageSelectorText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: 320,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
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
    top: 52,
    left: 12,
    width: 220,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    gap: 2,
  },
  sidebarDivider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    marginHorizontal: 6,
  },
  sidebarItemActive: {
    backgroundColor: C.accentDim,
  },
  sidebarItemText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
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
    gap: 12,
    paddingBottom: 60,
  },
  stateText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: C.textSecondary,
  },
  stateSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    maxWidth: 320,
    paddingHorizontal: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.accentDim,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.accent,
    marginTop: 4,
  },
  retryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.accent,
  },
  gridContent: {
    padding: 10,
    gap: 10,
  },
  gridRow: {
    gap: 10,
  },
  productCardWrap: {
    flex: 1,
  },
  productCard: {
    backgroundColor: C.card,
    borderRadius: 12,
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
    fontSize: 10,
    color: '#fff',
    backgroundColor: 'rgba(255, 0, 0, 0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
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
    fontSize: 10,
    color: '#fff',
    backgroundColor: 'rgba(80, 80, 80, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    transform: [{ rotate: '-10deg' }],
    letterSpacing: 0.5,
  },
  productInfo: {
    padding: 8,
    gap: 2,
  },
  productCategory: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: C.accentLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  productName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.text,
    lineHeight: 17,
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  productPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.textSecondary,
  },
  addBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
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
    paddingTop: 80,
    gap: 10,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textMuted,
  },
  categoryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    height: 52,
    justifyContent: 'center',
  },
  categoryBarContent: {
    paddingHorizontal: 10,
    gap: 6,
    alignItems: 'center',
  },
  categoryTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: C.card,
  },
  categoryTabSelected: {
    backgroundColor: C.accent,
  },
  categoryTabText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  categoryTabTextSelected: {
    color: '#fff',
  },
  cartPanel: {
    width: 240,
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    flexDirection: 'column',
  },
  cartTopActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  cartActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderTypeRow: {
    padding: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  orderTypeLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  orderTypeSelector: {
    flexDirection: 'row',
    gap: 4,
  },
  orderTypeChip: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: C.card,
    alignItems: 'center',
  },
  orderTypeChipActive: {
    backgroundColor: C.accent,
  },
  orderTypeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: C.textSecondary,
  },
  orderTypeTextActive: {
    color: '#fff',
  },
  cartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cartEmptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textMuted,
  },
  cartList: {
    flex: 1,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 4,
  },
  cartItemQty: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.accent,
    width: 22,
  },
  cartItemName: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.text,
    flex: 1,
  },
  cartItemPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: C.text,
  },
  cartRowActions: {
    flexDirection: 'row',
    gap: 3,
  },
  qtyMiniBtn: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  removeMiniBtn: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: C.dangerDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartFooter: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'flex-end',
  },
  clearRowText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.danger,
  },
  totalsBox: {
    gap: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabelText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textSecondary,
  },
  totalValueText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.textSecondary,
  },
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  discountInput: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: C.text,
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
    width: 60,
    textAlign: 'right',
  },
  totalsLine: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 3,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  grandTotalLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.text,
  },
  grandTotalRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemCountBadge: {
    backgroundColor: C.accent,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  itemCountText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: '#fff',
  },
  grandTotalValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.text,
  },
  printerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  printerBadgeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.success,
  },
  actionBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  saveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.textSecondary,
  },
  chargeBtn: {
    flex: 1.5,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 12,
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
    fontSize: 14,
    color: '#fff',
  },
  pendingBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#fff',
  },
  customerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  customerInput: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.text,
    padding: 0,
  },
  voidBtn: {
    marginTop: 4,
    backgroundColor: C.dangerDim,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  voidBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.danger,
  },
  pendingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: C.warningDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  paymentSelector: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: C.border,
  },
  paymentSelectorLeft: {
    gap: 1,
  },
  paymentSelectorLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: C.textMuted,
    textTransform: 'uppercase',
  },
  paymentSelectorValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
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
    maxWidth: 350,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    maxHeight: '60%',
    borderWidth: 1,
    borderColor: C.border,
  },
  pickerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickerOptionSelected: {
    backgroundColor: C.accentDim,
  },
  pickerOptionText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: C.textSecondary,
  },
  pickerOptionTextSelected: {
    color: C.accentLight,
  },
});
