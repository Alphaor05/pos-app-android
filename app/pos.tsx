import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  MaterialCommunityIcons,
  Ionicons,
  Feather,
  MaterialIcons,
} from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useCart, CartItem } from '@/context/CartContext';
import { useBluetooth } from '@/context/BluetoothContext';
import { PRODUCTS, CATEGORIES, Product } from '@/data/products';
import Colors from '@/constants/colors';

const C = Colors.dark;

type OrderType = 'Dine In' | 'Take Away' | 'Delivery';
const ORDER_TYPES: OrderType[] = ['Dine In', 'Take Away', 'Delivery'];

export default function POSScreen() {
  const { logout } = useAuth();
  const { items, addItem, removeItem, updateQuantity, clearCart, total } = useCart();
  const { connectedDevice, status: btStatus, printReceipt } = useBluetooth();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [printing, setPrinting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('Dine In');
  const [discount, setDiscount] = useState('0');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const filteredProducts = useMemo(() => {
    return PRODUCTS.filter(p => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [search, selectedCategory]);

  const discountAmount = parseFloat(discount) || 0;
  const taxAmount = total * 0.05;
  const grandTotal = total - discountAmount + taxAmount;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  const handleLogout = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logout();
    router.replace('/');
  };

  const handleCharge = async () => {
    if (items.length === 0) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (btStatus === 'connected') {
      setPrinting(true);
      const receiptItems = items.map(i => ({
        name: i.product.name,
        qty: i.quantity,
        price: i.product.price,
      }));
      await printReceipt(receiptItems, grandTotal);
      setPrinting(false);
    }
    setOrderSuccess(true);
    setTimeout(() => {
      clearCart();
      setOrderSuccess(false);
    }, 1800);
  };

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable
            style={styles.topBarIconBtn}
            onPress={() => setSidebarOpen(v => !v)}
          >
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
              placeholder="Search..."
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
            <SidebarItem icon="chart-bar" label="Reports" />
            <SidebarItem icon="account-multiple-outline" label="Customers" />
            <SidebarItem icon="cog-outline" label="Settings" onPress={() => { setSidebarOpen(false); router.push('/settings'); }} />
            <View style={styles.sidebarDivider} />
            <SidebarItem icon="logout" label="Logout" danger onPress={handleLogout} />
          </View>
        </Pressable>
      )}

      <View style={styles.body}>
        <View style={styles.mainArea}>
          <FlatList
            data={filteredProducts}
            keyExtractor={p => p.id}
            numColumns={4}
            key="grid-4"
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={[styles.gridContent, { paddingBottom: 60 + botPad }]}
            showsVerticalScrollIndicator={false}
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

          <View style={[styles.categoryBar, { bottom: botPad }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryBarContent}
            >
              {CATEGORIES.map(cat => (
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
          <View style={styles.cartTopActions}>
            <Pressable style={styles.cartActionBtn}>
              <Ionicons name="person-outline" size={18} color={C.textSecondary} />
            </Pressable>
            <Pressable style={styles.cartActionBtn}>
              <Ionicons name="notifications-outline" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.orderTypeRow}>
            <Text style={styles.orderTypeLabel}>Dine In</Text>
            <View style={styles.orderTypeSelector}>
              {ORDER_TYPES.map(t => (
                <Pressable
                  key={t}
                  style={[styles.orderTypeChip, orderType === t && styles.orderTypeChipActive]}
                  onPress={() => setOrderType(t)}
                >
                  <Text style={[styles.orderTypeText, orderType === t && styles.orderTypeTextActive]}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.cartEmpty}>
              <MaterialCommunityIcons name="cart-outline" size={40} color={C.textMuted} />
              <Text style={styles.cartEmptyText}>No items added</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => i.product.id}
              showsVerticalScrollIndicator={false}
              style={styles.cartList}
              renderItem={({ item }) => (
                <CartRow item={item} onUpdate={updateQuantity} onRemove={removeItem} />
              )}
            />
          )}

          <View style={styles.cartFooter}>
            {items.length > 0 && (
              <Pressable style={styles.clearRow} onPress={clearCart}>
                <Feather name="trash-2" size={13} color={C.danger} />
                <Text style={styles.clearRowText}>Clear order</Text>
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
              <TotalRow label="Tax and charges (USD)" value={taxAmount.toFixed(2)} />
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

            <View style={styles.actionBtns}>
              <Pressable style={styles.saveBtn} disabled={items.length === 0}>
                <Text style={styles.saveBtnText}>SAVE</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.chargeBtn,
                  items.length === 0 && styles.chargeBtnDisabled,
                  orderSuccess && styles.chargeBtnSuccess,
                ]}
                onPress={handleCharge}
                disabled={items.length === 0 || printing}
              >
                {orderSuccess ? (
                  <Text style={styles.chargeBtnText}>DONE!</Text>
                ) : printing ? (
                  <Text style={styles.chargeBtnText}>PRINTING...</Text>
                ) : (
                  <Text style={styles.chargeBtnText}>CHARGE</Text>
                )}
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
    <Pressable
      style={[styles.sidebarItem, active && styles.sidebarItemActive]}
      onPress={onPress}
    >
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
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(product);
  };

  return (
    <Pressable
      onPressIn={() => { scale.value = withSpring(0.95, { damping: 10 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 10 }); }}
      onPress={handlePress}
      style={styles.productCardWrap}
    >
      <Animated.View style={[styles.productCard, animStyle]}>
        <Image
          source={{ uri: product.imageUrl }}
          style={styles.productImage}
          contentFit="cover"
          transition={200}
        />
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <View style={styles.productPriceRow}>
            <Text style={styles.productPrice}>USD {product.price.toFixed(2)}</Text>
            <Pressable style={styles.addBtn} onPress={handlePress}>
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
        <Pressable
          style={styles.qtyMiniBtn}
          onPress={() => onUpdate(item.product.id, item.quantity - 1)}
        >
          <Feather name="minus" size={11} color={C.text} />
        </Pressable>
        <Pressable
          style={styles.qtyMiniBtn}
          onPress={() => onUpdate(item.product.id, item.quantity + 1)}
        >
          <Feather name="plus" size={11} color={C.text} />
        </Pressable>
        <Pressable
          style={styles.removeMiniBtn}
          onPress={() => onRemove(item.product.id)}
        >
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
  productInfo: {
    padding: 8,
    gap: 4,
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
});
