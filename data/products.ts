export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url: string;
  sku?: string;
}

export const FALLBACK_PRODUCTS: Product[] = [
  { id: '1', name: 'Espresso', price: 2.50, category: 'Beverages', image_url: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=200&q=80' },
  { id: '2', name: 'Cappuccino', price: 3.80, category: 'Beverages', image_url: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=200&q=80' },
  { id: '3', name: 'Club Sandwich', price: 8.90, category: 'Food', image_url: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=200&q=80' },
  { id: '4', name: 'Chocolate Muffin', price: 2.80, category: 'Snacks', image_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&q=80' },
];
