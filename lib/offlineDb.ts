import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('pos.db');

export interface SaleRecord {
  id: string;
  data: Record<string, any>;
  synced: boolean;
  created_at: string;
}

export function initDb() {
  try {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT,
        price REAL,
        category TEXT,
        image_url TEXT
      );
    `);

    db.execSync(`
      CREATE TABLE IF NOT EXISTS store_inventory (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        quantity INTEGER,
        shop_id TEXT
      );
    `);

    db.execSync(`
      CREATE TABLE IF NOT EXISTS sales_queue (
        id TEXT PRIMARY KEY,
        data TEXT,
        synced INTEGER DEFAULT 0,
        created_at TEXT
      );
    `);
  } catch (e) {
    console.warn('DB init error (may be benign if tables exist):', e);
  }
}

export function queueSale(sale: any): Promise<void> {
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
