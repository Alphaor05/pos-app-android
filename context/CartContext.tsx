import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { Alert } from 'react-native';
import { Product } from '@/data/products';

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = (product: Product) => {
    setItems(prev => {
      const existing = prev.find(i => String(i.product.id) === String(product.id));
      if (existing) {
        if (existing.quantity >= (product.inStock ?? 0)) {
          Alert.alert('Out of Stock', `Cannot add more ${product.name}. Only ${product.inStock} items are in stock.`);
          return prev;
        }
        return prev.map(i =>
          String(i.product.id) === String(product.id)
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }

      if ((product.inStock ?? 0) <= 0) {
        Alert.alert('Out of Stock', `${product.name} is currently out of stock.`);
        return prev;
      }

      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => String(i.product.id) !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }

    setItems(prev =>
      prev.map(i => {
        if (String(i.product.id) === productId) {
          if (quantity > (i.product.inStock ?? 0)) {
            Alert.alert('Out of Stock', `Cannot increase quantity. Only ${i.product.inStock} items are in stock.`);
            return i;
          }
          return { ...i, quantity };
        }
        return i;
      })
    );
  };

  const clearCart = () => setItems([]);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    [items]
  );

  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const value = useMemo(() => ({
    items,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    total,
    itemCount,
  }), [items, total, itemCount]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
