import { Platform } from 'react-native';

let db: any = null;

function getDb() {
  if (db) return db;
  if (Platform.OS === 'web') return null;
  const SQLite = require('expo-sqlite');
  db = SQLite.openDatabaseSync('pos.db');
  return db;
}

export interface SaleRecord {
  id: string;
  // `data` may contain whatever we queued for the sale.  after the
  // recent changes it will typically include `orderId`, totals and an
  // optional `posId` attribute so the backend knows which terminal
  // originated the transaction.
  data: Record<string, any>;
  synced: boolean;
  created_at: string;
}

// simple in-memory queue for web
const webQueue: SaleRecord[] = [];

export interface ProductRecord {
  id: string;
  name: string;
  price: number;
  category?: string;
  image_url?: string;
}

const WEB_SAMPLE_PRODUCTS: ProductRecord[] = [
  { id: '1', name: 'Bread White', price: 1.2, category: 'Bakery' },
  { id: '2', name: 'Butter 250g', price: 6.0, category: 'Dairy' },
  { id: '3', name: 'Coca Cola 330ml', price: 2.5, category: 'Beverages' },
];

export function getProducts(): Promise<ProductRecord[]> {
  if (Platform.OS === 'web') {
    // return sample list for web since sqlite not available
    return Promise.resolve(WEB_SAMPLE_PRODUCTS);
  }
  const localDb = getDb();
  if (!localDb) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      const rows = localDb.getAllSync(`SELECT * FROM products ORDER BY name ASC;`);
      resolve(rows);
    } catch (e) {
      resolve([]);
    }
  });
}

export function addProduct(p: ProductRecord): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `INSERT OR REPLACE INTO products (id, name, price, category, image_url) VALUES (?, ?, ?, ?, ?);`,
        [p.id, p.name, p.price, p.category || null, p.image_url || null]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function initDb() {
  const localDb = getDb();
  if (!localDb) return; // web – nothing to do

  try {
    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT,
        price REAL,
        category TEXT,
        image_url TEXT
      );
    `);

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS store_inventory (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        quantity INTEGER,
        shop_id TEXT
      );
    `);

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS sales_queue (
        id TEXT PRIMARY KEY,
        data TEXT,
        synced INTEGER DEFAULT 0,
        created_at TEXT
      );
    `);

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS activity_logs_queue (
        id TEXT PRIMARY KEY,
        data TEXT,
        synced INTEGER DEFAULT 0,
        created_at TEXT
      );
    `);

    // seed a couple items if products table is empty
    const countRow = localDb.getFirstSync(`SELECT COUNT(*) as c FROM products;`);
    if (countRow && countRow.c === 0) {
      const samples = [
        { id: '1', name: 'Bread White', price: 1.2, category: 'Bakery' },
        { id: '2', name: 'Butter 250g', price: 6.0, category: 'Dairy' },
      ];
      samples.forEach(p => {
        localDb.runSync(
          `INSERT INTO products (id, name, price, category) VALUES (?, ?, ?, ?);`,
          [p.id, p.name, p.price, p.category]
        );
      });
    }
  } catch (e) {
    console.warn('DB init error (may be benign if tables exist):', e);
  }
}


export function queueSale(sale: any): Promise<void> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const id = sale.orderId || Date.now().toString() + Math.random().toString(36).substr(2, 6);
      const rec: SaleRecord = {
        id,
        data: sale,
        synced: false,
        created_at: new Date().toISOString(),
      };
      webQueue.push(rec);
      resolve();
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const id = sale.orderId || Date.now().toString() + Math.random().toString(36).substr(2, 6);
      const dataStr = JSON.stringify(sale);
      const created = new Date().toISOString();
      db.runSync(
        `INSERT INTO sales_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
        [id, dataStr, 0, created]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getPendingSales(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve(webQueue.filter(r => !r.synced));
  }

  return new Promise((resolve, reject) => {
    try {
      const rows = db.getAllSync(`SELECT * FROM sales_queue WHERE synced = 0;`);
      const arr: SaleRecord[] = rows.map((r: any) => ({
        id: r.id,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
        synced: r.synced === 1,
        created_at: r.created_at,
      }));
      resolve(arr);
    } catch (err) {
      reject(err);
    }
  });
}

export function getAllSales(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve([...webQueue].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  return new Promise((resolve, reject) => {
    try {
      const rows = db.getAllSync(`SELECT * FROM sales_queue ORDER BY created_at DESC;`);
      const arr: SaleRecord[] = rows.map((r: any) => ({
        id: r.id,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
        synced: r.synced === 1,
        created_at: r.created_at,
      }));
      resolve(arr);
    } catch (err) {
      reject(err);
    }
  });
}

export function markSaleSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const rec = webQueue.find(r => r.id === id);
      if (rec) rec.synced = true;
      resolve();
    });
  }

  return new Promise((resolve, reject) => {
    try {
      db.runSync(
        `UPDATE sales_queue SET synced = 1 WHERE id = ?;`,
        [id]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function queueActivityLog(log: any): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
      const dataStr = JSON.stringify(log);
      const created = new Date().toISOString();
      localDb.runSync(
        `INSERT INTO activity_logs_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
        [id, dataStr, 0, created]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getPendingActivityLogs(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') return Promise.resolve([]);
  const localDb = getDb();
  if (!localDb) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    try {
      const rows = localDb.getAllSync(`SELECT * FROM activity_logs_queue WHERE synced = 0;`);
      const arr: SaleRecord[] = rows.map((r: any) => ({
        id: r.id,
        data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
        synced: r.synced === 1,
        created_at: r.created_at,
      }));
      resolve(arr);
    } catch (err) {
      reject(err);
    }
  });
}

export function markActivityLogSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `UPDATE activity_logs_queue SET synced = 1 WHERE id = ?;`,
        [id]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
