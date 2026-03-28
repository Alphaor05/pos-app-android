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
  in_stock?: number;
}

export interface DiscountPlanRecord {
  id: string;
  name: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applicable_to: 'all' | 'category' | 'product';
  target_id?: string;
  target_name?: string;
  status: string;
  start_date: string;
  end_date: string;
}

export interface PricingPlanRecord {
  id: string;
  name: string;
  description?: string;
  price_multiplier: number;
  applicable_to: 'all' | 'category' | 'product';
  target_id?: string;
  target_name?: string;
  status: string;
  start_date: string;
  end_date: string;
}

export interface ReceiptDesignRecord {
  id: string;
  shop_id?: string | null;
  header?: string | null;
  footer?: string | null;
  receipt_size: string;
}

export interface EmployeeRecord {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  shop: string | null;
  pin: string;
  status: string;
}

export interface OfflineAccessLog {
  id: string;
  employee_id: string;
  shop_id: string;
  login_time: string;
  logout_time: string | null;
  synced: boolean;
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
        `INSERT OR REPLACE INTO products (id, name, price, category, image_url, in_stock) VALUES (?, ?, ?, ?, ?, ?);`,
        [p.id, p.name, p.price, p.category || null, p.image_url || null, p.in_stock ?? 9999]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function clearProducts(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(`DELETE FROM products;`);
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
        image_url TEXT,
        in_stock INTEGER DEFAULT 9999
      );
    `);

    // Migration: add in_stock column to existing databases
    try {
      const productTableInfo = localDb.getAllSync(`PRAGMA table_info(products);`);
      const hasInStock = productTableInfo.some((c: any) => c.name === 'in_stock');
      if (!hasInStock) {
        localDb.execSync(`ALTER TABLE products ADD COLUMN in_stock INTEGER DEFAULT 9999;`);
      }
    } catch (e) {
      console.warn('Migration for products.in_stock failed:', e);
    }

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
    
    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS discount_plans (
        id TEXT PRIMARY KEY,
        name TEXT,
        discount_type TEXT,
        discount_value REAL,
        applicable_to TEXT,
        target_id TEXT,
        target_name TEXT,
        status TEXT,
        start_date TEXT,
        end_date TEXT,
        shop_id TEXT
      );
    `);

    // Ensure shop_id exists for older DB versions
    try {
      const tableInfo = localDb.getAllSync(`PRAGMA table_info(discount_plans);`);
      const hasShopId = tableInfo.some((c: any) => c.name === 'shop_id');
      if (!hasShopId) {
        localDb.execSync(`ALTER TABLE discount_plans ADD COLUMN shop_id TEXT;`);
      }
      const hasTargetName = tableInfo.some((c: any) => c.name === 'target_name');
      if (!hasTargetName) {
        localDb.execSync(`ALTER TABLE discount_plans ADD COLUMN target_name TEXT;`);
      }
    } catch (e) {
      console.warn('Migration for discount_plans failed:', e);
    }

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS pricing_plans (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        price_multiplier REAL,
        applicable_to TEXT,
        target_id TEXT,
        target_name TEXT,
        status TEXT,
        start_date TEXT,
        end_date TEXT,
        shop_id TEXT
      );
    `);

    // Ensure shop_id and target_name exist for pricing_plans
    try {
      const tableInfo = localDb.getAllSync(`PRAGMA table_info(pricing_plans);`);
      const hasShopId = tableInfo.some((c: any) => c.name === 'shop_id');
      if (!hasShopId) {
        localDb.execSync(`ALTER TABLE pricing_plans ADD COLUMN shop_id TEXT;`);
      }
      const hasTargetName = tableInfo.some((c: any) => c.name === 'target_name');
      if (!hasTargetName) {
        localDb.execSync(`ALTER TABLE pricing_plans ADD COLUMN target_name TEXT;`);
      }
    } catch (e) {
      console.warn('Migration for pricing_plans failed:', e);
    }

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS receipt_designs (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        header TEXT,
        footer TEXT,
        receipt_size TEXT
      );
    `);

    // Added for offline login
    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS employees (
        employee_id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        role TEXT,
        shop TEXT,
        pin TEXT,
        status TEXT
      );
    `);

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS access_logs_queue (
        id TEXT PRIMARY KEY,
        employee_id TEXT,
        shop_id TEXT,
        login_time TEXT,
        logout_time TEXT,
        synced INTEGER DEFAULT 0
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
      console.log(`[OfflineDB] Sale ${id} queued successfully for sync.`);
      resolve();
    } catch (err) {
      console.error(`[OfflineDB] Failed to queue sale ${sale?.orderId}:`, err);
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

export function saveDiscountPlan(p: DiscountPlanRecord & { shop_id: string }): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `INSERT OR REPLACE INTO discount_plans (id, name, discount_type, discount_value, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [p.id, p.name, p.discount_type, p.discount_value, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function clearDiscountPlans(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(`DELETE FROM discount_plans;`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getDiscountPlans(shopId?: string | null): Promise<DiscountPlanRecord[]> {
  if (Platform.OS === 'web') return Promise.resolve([]);
  const localDb = getDb();
  if (!localDb) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      let query = `SELECT * FROM discount_plans WHERE status = 'active'`;
      const params: any[] = [];
      if (shopId) {
        query += ` AND shop_id = ?`;
        params.push(shopId);
      }
      const rows = localDb.getAllSync(query, params);
      resolve(rows);
    } catch (e) {
      resolve([]);
    }
  });
}

export function savePricingPlan(p: PricingPlanRecord & { shop_id: string }): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `INSERT OR REPLACE INTO pricing_plans (id, name, description, price_multiplier, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [p.id, p.name, p.description || null, p.price_multiplier, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function clearPricingPlans(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(`DELETE FROM pricing_plans;`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getPricingPlans(shopId?: string | null): Promise<PricingPlanRecord[]> {
  if (Platform.OS === 'web') return Promise.resolve([]);
  const localDb = getDb();
  if (!localDb) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      let query = `SELECT * FROM pricing_plans WHERE status = 'active'`;
      const params: any[] = [];
      if (shopId) {
        query += ` AND shop_id = ?`;
        params.push(shopId);
      }
      const rows = localDb.getAllSync(query, params);
      resolve(rows);
    } catch (e) {
      resolve([]);
    }
  });
}
export function saveReceiptDesign(d: ReceiptDesignRecord): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `INSERT OR REPLACE INTO receipt_designs (id, shop_id, header, footer, receipt_size) VALUES (?, ?, ?, ?, ?);`,
        [d.id, d.shop_id || null, d.header || null, d.footer || null, d.receipt_size]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getReceiptDesign(shopId?: string | null): Promise<ReceiptDesignRecord | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  const localDb = getDb();
  if (!localDb) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      let query = `SELECT * FROM receipt_designs`;
      const params: any[] = [];
      if (shopId) {
        query += ` WHERE shop_id = ? OR shop_id IS NULL`;
        params.push(shopId);
        query += ` ORDER BY shop_id DESC LIMIT 1;`;
      } else {
        query += ` LIMIT 1;`;
      }
      const row = localDb.getFirstSync(query, params);
      resolve(row || null);
    } catch (e) {
      resolve(null);
    }
  });
}

// --- Employee functions ---

export function saveEmployee(emp: EmployeeRecord): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `INSERT OR REPLACE INTO employees (employee_id, first_name, last_name, role, shop, pin, status) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [emp.employee_id, emp.first_name, emp.last_name, emp.role, emp.shop, emp.pin, emp.status]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getEmployeeByPin(pin: string): Promise<EmployeeRecord | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  const localDb = getDb();
  if (!localDb) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const row = localDb.getFirstSync(
        `SELECT * FROM employees WHERE pin = ? AND status = 'active' LIMIT 1;`,
        [pin]
      );
      resolve(row || null);
    } catch (e) {
      resolve(null);
    }
  });
}

export function clearEmployees(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(`DELETE FROM employees;`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

// --- Access Log functions ---

export function queueAccessLog(log: Omit<OfflineAccessLog, 'id' | 'synced' | 'logout_time'>): Promise<string> {
  if (Platform.OS === 'web') return Promise.resolve('web-id');
  const localDb = getDb();
  if (!localDb) return Promise.resolve('no-db');
  return new Promise((resolve, reject) => {
    try {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
      localDb.runSync(
        `INSERT INTO access_logs_queue (id, employee_id, shop_id, login_time, synced) VALUES (?, ?, ?, ?, 0);`,
        [id, log.employee_id, log.shop_id, log.login_time]
      );
      resolve(id);
    } catch (err) {
      reject(err);
    }
  });
}

export function updateAccessLogLogout(id: string, logoutTime: string): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(
        `UPDATE access_logs_queue SET logout_time = ? WHERE id = ?;`,
        [logoutTime, id]
      );
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function getPendingAccessLogs(): Promise<OfflineAccessLog[]> {
  if (Platform.OS === 'web') return Promise.resolve([]);
  const localDb = getDb();
  if (!localDb) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    try {
      const rows = localDb.getAllSync(`SELECT * FROM access_logs_queue WHERE synced = 0;`);
      resolve(rows.map((r: any) => ({ ...r, synced: r.synced === 1 })));
    } catch (err) {
      reject(err);
    }
  });
}

export function markAccessLogSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const localDb = getDb();
  if (!localDb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      localDb.runSync(`UPDATE access_logs_queue SET synced = 1 WHERE id = ?;`, [id]);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
