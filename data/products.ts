export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  imageUrl: string;
  sku: string;
}

export const CATEGORIES = ['All', 'Beverages', 'Food', 'Snacks', 'Electronics', 'Accessories'];

export const PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Espresso',
    price: 2.50,
    category: 'Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=200&q=80',
    sku: 'BEV001',
  },
  {
    id: '2',
    name: 'Cappuccino',
    price: 3.80,
    category: 'Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=200&q=80',
    sku: 'BEV002',
  },
  {
    id: '3',
    name: 'Latte',
    price: 4.20,
    category: 'Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=200&q=80',
    sku: 'BEV003',
  },
  {
    id: '4',
    name: 'Orange Juice',
    price: 3.50,
    category: 'Beverages',
    imageUrl: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200&q=80',
    sku: 'BEV004',
  },
  {
    id: '5',
    name: 'Club Sandwich',
    price: 8.90,
    category: 'Food',
    imageUrl: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=200&q=80',
    sku: 'FOOD001',
  },
  {
    id: '6',
    name: 'Caesar Salad',
    price: 7.50,
    category: 'Food',
    imageUrl: 'https://images.unsplash.com/photo-1546793665-c74683f339c1?w=200&q=80',
    sku: 'FOOD002',
  },
  {
    id: '7',
    name: 'Margherita Pizza',
    price: 11.00,
    category: 'Food',
    imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=200&q=80',
    sku: 'FOOD003',
  },
  {
    id: '8',
    name: 'Chocolate Muffin',
    price: 2.80,
    category: 'Snacks',
    imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&q=80',
    sku: 'SNK001',
  },
  {
    id: '9',
    name: 'Potato Chips',
    price: 1.90,
    category: 'Snacks',
    imageUrl: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=200&q=80',
    sku: 'SNK002',
  },
  {
    id: '10',
    name: 'Granola Bar',
    price: 2.20,
    category: 'Snacks',
    imageUrl: 'https://images.unsplash.com/photo-1551948612-40023a15f2b0?w=200&q=80',
    sku: 'SNK003',
  },
  {
    id: '11',
    name: 'USB-C Cable',
    price: 12.99,
    category: 'Electronics',
    imageUrl: 'https://images.unsplash.com/photo-1588802427736-1e63c36b0ef3?w=200&q=80',
    sku: 'ELEC001',
  },
  {
    id: '12',
    name: 'Power Bank',
    price: 29.99,
    category: 'Electronics',
    imageUrl: 'https://images.unsplash.com/photo-1609592177049-b6b0e36f67d4?w=200&q=80',
    sku: 'ELEC002',
  },
  {
    id: '13',
    name: 'Wireless Earbuds',
    price: 49.99,
    category: 'Electronics',
    imageUrl: 'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=200&q=80',
    sku: 'ELEC003',
  },
  {
    id: '14',
    name: 'Sunglasses',
    price: 18.50,
    category: 'Accessories',
    imageUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=200&q=80',
    sku: 'ACC001',
  },
  {
    id: '15',
    name: 'Tote Bag',
    price: 14.00,
    category: 'Accessories',
    imageUrl: 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=200&q=80',
    sku: 'ACC002',
  },
];
