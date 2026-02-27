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
  Alert,
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
} from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useCart, CartItem } from '@/context/CartContext';
import { useBluetooth } from '@/context/BluetoothContext';
import { PRODUCTS, CATEGORIES, Product } from '@/data/products';
import Colors from '@/constants/colors';

const C = Colors.dark;

export default function POSScreen() {
  const { logout } = useAuth();
  const { items, addItem, removeItem, updateQuantity, clearCart, total, itemCount } = useCart();
  const { connectedDevice, status: btStatus, printReceipt } = useBluetooth();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [printing, setPrinting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

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
      await printReceipt(receiptItems, total);
      setPrinting(false);
    }

    setOrderSuccess(true);
    setTimeout(() => {
      clearCart();
      setOrderSuccess(false);
    }, 1800);
  };

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>
      <Sidebar onLogout={handleLogout} onSettings={() => router.push('/settings')} btConnected={btStatus === 'connected'} />

      <View style={styles.mainArea}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Feather name="search" size={18} color={C.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products or SKU..."
              placeholderTextColor={C.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Feather name="x" size={16} color={C.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categoriesContent}
        >
          {CATEGORIES.map(cat => (
            <CategoryChip
              key={cat}
              label={cat}
              selected={selectedCategory === cat}
              onPress={() => setSelectedCategory(cat)}
            />
          ))}
        </ScrollView>

        <FlatList
          data={filteredProducts}
          keyExtractor={p => p.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={addItem} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="package" size={40} color={C.textMuted} />
              <Text style={styles.emptyText}>No products found</Text>
            </View>
          }
        />
      </View>

      <View style={styles.cartPanel}>
        <View style={styles.cartHeader}>
          <Text style={styles.cartTitle}>Order</Text>
          {itemCount > 0 && (
            <Pressable onPress={clearCart} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {items.length === 0 ? (
          <View style={styles.cartEmpty}>
            <MaterialCommunityIcons name="cart-outline" size={48} color={C.textMuted} />
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
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalAmount}>${total.toFixed(2)}</Text>
          </View>
          <View style={[styles.totalRow, styles.totalRowTax]}>
            <Text style={styles.taxLabel}>Tax (8%)</Text>
            <Text style={styles.taxAmount}>${(total * 0.08).toFixed(2)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.grandTotalLabel}>TOTAL</Text>
            <Text style={styles.grandTotalAmount}>${(total * 1.08).toFixed(2)}</Text>
          </View>

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
              <>
                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                <Text style={styles.chargeBtnText}>Sale Complete!</Text>
              </>
            ) : printing ? (
              <>
                <MaterialCommunityIcons name="printer-outline" size={22} color="#fff" />
                <Text style={styles.chargeBtnText}>Printing...</Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons name="cash-register" size={22} color="#fff" />
                <Text style={styles.chargeBtnText}>
                  Charge ${(total * 1.08).toFixed(2)}
                </Text>
              </>
            )}
          </Pressable>

          {btStatus === 'connected' && connectedDevice && (
            <View style={styles.printerBadge}>
              <MaterialCommunityIcons name="printer-check" size={12} color={C.success} />
              <Text style={styles.printerBadgeText}>{connectedDevice.name}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function Sidebar({
  onLogout,
  onSettings,
  btConnected,
}: {
  onLogout: () => void;
  onSettings: () => void;
  btConnected: boolean;
}) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.sidebarLogo}>
        <MaterialCommunityIcons name="point-of-sale" size={26} color={C.accent} />
      </View>

      <View style={styles.sidebarDivider} />

      <SidebarBtn icon="cog-outline" onPress={onSettings} badge={!btConnected} />

      <View style={{ flex: 1 }} />

      <SidebarBtn icon="logout" onPress={onLogout} danger />
    </View>
  );
}

function SidebarBtn({
  icon,
  onPress,
  danger,
  badge,
}: {
  icon: string;
  onPress: () => void;
  danger?: boolean;
  badge?: boolean;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPressIn={() => { scale.value = withSpring(0.85); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      onPress={onPress}
      style={styles.sidebarBtnContainer}
    >
      <Animated.View style={[styles.sidebarBtn, animStyle]}>
        <MaterialCommunityIcons
          name={icon as any}
          size={24}
          color={danger ? C.danger : C.textSecondary}
        />
        {badge && (
          <View style={styles.badgeDot} />
        )}
      </Animated.View>
    </Pressable>
  );
}

function CategoryChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
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
          <Text style={styles.productPrice}>${product.price.toFixed(2)}</Text>
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
      <View style={styles.cartRowInfo}>
        <Text style={styles.cartItemName} numberOfLines={1}>{item.product.name}</Text>
        <Text style={styles.cartItemPrice}>${subtotal.toFixed(2)}</Text>
      </View>
      <View style={styles.cartRowControls}>
        <Pressable
          onPress={() => onUpdate(item.product.id, item.quantity - 1)}
          style={styles.qtyBtn}
        >
          <Feather name="minus" size={14} color={C.text} />
        </Pressable>
        <Text style={styles.qtyText}>{item.quantity}</Text>
        <Pressable
          onPress={() => onUpdate(item.product.id, item.quantity + 1)}
          style={styles.qtyBtn}
        >
          <Feather name="plus" size={14} color={C.text} />
        </Pressable>
        <Pressable
          onPress={() => onRemove(item.product.id)}
          style={styles.removeBtn}
        >
          <Feather name="x" size={14} color={C.danger} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: C.background,
  },
  sidebar: {
    width: 68,
    backgroundColor: C.surface,
    borderRightWidth: 1,
    borderRightColor: C.border,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  sidebarLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sidebarDivider: {
    width: 36,
    height: 1,
    backgroundColor: C.border,
    marginVertical: 4,
  },
  sidebarBtnContainer: {
    padding: 4,
  },
  sidebarBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.warning,
    borderWidth: 1.5,
    borderColor: C.card,
  },
  mainArea: {
    flex: 1,
    backgroundColor: C.background,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: C.text,
    padding: 0,
  },
  categoriesScroll: {
    maxHeight: 44,
    marginBottom: 8,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipSelected: {
    backgroundColor: C.accentDim,
    borderColor: C.accent,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  chipTextSelected: {
    color: C.accentLight,
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 10,
  },
  gridRow: {
    gap: 10,
    justifyContent: 'flex-start',
  },
  productCardWrap: {
    flex: 1,
    maxWidth: '33.3%',
  },
  productCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  productImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: C.surface,
  },
  productInfo: {
    padding: 10,
    gap: 2,
  },
  productName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.text,
    lineHeight: 18,
  },
  productPrice: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: C.accent,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: C.textMuted,
  },
  cartPanel: {
    width: 300,
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.border,
    flexDirection: 'column',
  },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  cartTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: C.dangerDim,
  },
  clearBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.danger,
  },
  cartList: {
    flex: 1,
  },
  cartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  cartEmptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.textMuted,
  },
  cartRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 6,
  },
  cartRowInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cartItemName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.text,
    flex: 1,
    marginRight: 8,
  },
  cartItemPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  cartRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  qtyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: C.text,
    minWidth: 24,
    textAlign: 'center',
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.dangerDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  cartFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
    gap: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  totalRowTax: {
    marginBottom: 2,
  },
  totalLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.textSecondary,
  },
  totalAmount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  taxLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
  },
  taxAmount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 2,
  },
  grandTotalLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: C.text,
    letterSpacing: 0.5,
  },
  grandTotalAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: C.text,
  },
  chargeBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  chargeBtnDisabled: {
    opacity: 0.4,
  },
  chargeBtnSuccess: {
    backgroundColor: C.success,
  },
  chargeBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#fff',
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
});
