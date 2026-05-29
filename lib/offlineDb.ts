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
  sync_attempts?: number;
  last_error?: string | null;
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
  auto_print?: boolean;
  styled_header?: boolean;
  cash_drawer?: boolean;
  printer_name?: string;
  print_mode?: string;
  extra_space?: string;
  drawer_cmds?: string;
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

export async function getProducts(): Promise<ProductRecord[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve(WEB_SAMPLE_PRODUCTS);
  }
  const localDb = getDb();
  if (!localDb) return [];
  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM products ORDER BY name ASC;`);
    return rows as ProductRecord[];
  } catch (e) {
    console.warn('[OfflineDB] getProducts error:', e);
    return [];
  }
}

export async function addProduct(p: ProductRecord): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `INSERT OR REPLACE INTO products (id, name, price, category, image_url, in_stock) VALUES (?, ?, ?, ?, ?, ?);`,
      [p.id, p.name, p.price, p.category || null, p.image_url || null, p.in_stock ?? 9999]
    );
  } catch (err) {
    console.error('[OfflineDB] addProduct error:', err);
    throw err;
  }
}

/**
 * Bulk insert products within a single transaction for maximum performance.
 */
export async function bulkAddProducts(products: ProductRecord[]): Promise<void> {
  if (Platform.OS === 'web' || products.length === 0) return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.withTransactionAsync(async () => {
      for (const p of products) {
        await localDb.runAsync(
          `INSERT OR REPLACE INTO products (id, name, price, category, image_url, in_stock) VALUES (?, ?, ?, ?, ?, ?);`,
          [p.id, p.name, p.price, p.category || null, p.image_url || null, p.in_stock ?? 9999]
        );
      }
    });
  } catch (err) {
    console.error('[OfflineDB] bulkAddProducts error:', err);
    throw err;
  }
}

export async function clearProducts(): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`DELETE FROM products;`);
  } catch (err) {
    console.error('[OfflineDB] clearProducts error:', err);
    throw err;
  }
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
        sync_attempts INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TEXT
      );
    `);

    // Migration for sales_queue
    try {
      const salesTableInfo = localDb.getAllSync(`PRAGMA table_info(sales_queue);`);
      const columns = salesTableInfo.map((c: any) => c.name);
      if (!columns.includes('sync_attempts')) {
        localDb.execSync(`ALTER TABLE sales_queue ADD COLUMN sync_attempts INTEGER DEFAULT 0;`);
      }
      if (!columns.includes('last_error')) {
        localDb.execSync(`ALTER TABLE sales_queue ADD COLUMN last_error TEXT;`);
      }
    } catch (e) {
      console.warn('Migration for sales_queue failed:', e);
    }

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
        receipt_size TEXT,
        auto_print INTEGER DEFAULT 1,
        styled_header INTEGER DEFAULT 0,
        cash_drawer INTEGER DEFAULT 0,
        printer_name TEXT,
        print_mode TEXT,
        extra_space TEXT,
        drawer_cmds TEXT
      );
    `);

    // Migrations for receipt_designs
    try {
      const tableInfo = localDb.getAllSync(`PRAGMA table_info(receipt_designs);`);
      const columns = tableInfo.map((c: any) => c.name);
      if (!columns.includes('auto_print')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN auto_print INTEGER DEFAULT 1;`);
      }
      if (!columns.includes('styled_header')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN styled_header INTEGER DEFAULT 0;`);
      }
      if (!columns.includes('cash_drawer')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN cash_drawer INTEGER DEFAULT 0;`);
      }
      if (!columns.includes('printer_name')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN printer_name TEXT;`);
      }
      if (!columns.includes('print_mode')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN print_mode TEXT;`);
      }
      if (!columns.includes('extra_space')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN extra_space TEXT;`);
      }
      if (!columns.includes('drawer_cmds')) {
        localDb.execSync(`ALTER TABLE receipt_designs ADD COLUMN drawer_cmds TEXT;`);
      }
    } catch (e) {
      console.warn('Migration for receipt_designs failed:', e);
    }

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
    if (countRow && (countRow as any).c === 0) {
      const samples = [
        { id: '1', name: 'Bread White', price: 1.2, category: 'Bakery' },
        { id: '2', name: 'Butter 250g', price: 6.0, category: 'Dairy' },
      ];
      localDb.withTransactionSync(() => {
        samples.forEach(p => {
          localDb.runSync(
            `INSERT INTO products (id, name, price, category) VALUES (?, ?, ?, ?);`,
            [p.id, p.name, p.price, p.category]
          );
        });
      });
    }
  } catch (e) {
    console.warn('DB init error (may be benign if tables exist):', e);
  }
}


export async function queueSale(sale: any): Promise<void> {
  if (Platform.OS === 'web') {
    const id = sale.orderId || Date.now().toString() + Math.random().toString(36).substr(2, 6);
    const rec: SaleRecord = {
      id,
      data: sale,
      synced: false,
      created_at: new Date().toISOString(),
    };
    webQueue.push(rec);
    return;
  }

  const localDb = getDb();
  if (!localDb) return;

  try {
    const id = sale.orderId || Date.now().toString() + Math.random().toString(36).substr(2, 6);
    const dataStr = JSON.stringify(sale);
    const created = new Date().toISOString();
    await localDb.runAsync(
      `INSERT INTO sales_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
      [id, dataStr, 0, created]
    );
    console.log(`[OfflineDB] Sale ${id} queued successfully for sync.`);
  } catch (err) {
    console.error(`[OfflineDB] Failed to queue sale ${sale?.orderId}:`, err);
    throw err;
  }
}

export async function getPendingSales(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') {
    return webQueue.filter(r => !r.synced);
  }

  const localDb = getDb();
  if (!localDb) return [];

  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM sales_queue WHERE synced = 0;`);
    return rows.map((r: any) => ({
      id: r.id,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      synced: r.synced === 1,
      sync_attempts: r.sync_attempts || 0,
      last_error: r.last_error || null,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error('[OfflineDB] getPendingSales error:', err);
    return [];
  }
}

export async function getAllSales(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') {
    return [...webQueue].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const localDb = getDb();
  if (!localDb) return [];

  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM sales_queue ORDER BY created_at DESC;`);
    return rows.map((r: any) => ({
      id: r.id,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      synced: r.synced === 1,
      sync_attempts: r.sync_attempts || 0,
      last_error: r.last_error || null,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error('[OfflineDB] getAllSales error:', err);
    return [];
  }
}

export async function markSaleSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    const rec = webQueue.find(r => r.id === id);
    if (rec) rec.synced = true;
    return;
  }

  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.runAsync(
      `UPDATE sales_queue SET synced = 1 WHERE id = ?;`,
      [id]
    );
  } catch (err) {
    console.error('[OfflineDB] markSaleSynced error:', err);
    throw err;
  }
}

export async function updateSaleSyncProgress(id: string, attempts: number, error: string | null): Promise<void> {
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `UPDATE sales_queue SET sync_attempts = ?, last_error = ? WHERE id = ?;`,
      [attempts, error, id]
    );
  } catch (err) {
    console.error('[OfflineDB] updateSaleSyncProgress error:', err);
  }
}

export async function queueActivityLog(log: any): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    const dataStr = JSON.stringify(log);
    const created = new Date().toISOString();
    await localDb.runAsync(
      `INSERT INTO activity_logs_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
      [id, dataStr, 0, created]
    );
  } catch (err) {
    console.error('[OfflineDB] queueActivityLog error:', err);
    throw err;
  }
}

export async function getPendingActivityLogs(): Promise<SaleRecord[]> {
  if (Platform.OS === 'web') return [];
  const localDb = getDb();
  if (!localDb) return [];

  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM activity_logs_queue WHERE synced = 0;`);
    return rows.map((r: any) => ({
      id: r.id,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      synced: r.synced === 1,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error('[OfflineDB] getPendingActivityLogs error:', err);
    return [];
  }
}

export async function markActivityLogSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.runAsync(
      `UPDATE activity_logs_queue SET synced = 1 WHERE id = ?;`,
      [id]
    );
  } catch (err) {
    console.error('[OfflineDB] markActivityLogSynced error:', err);
    throw err;
  }
}

export async function saveDiscountPlan(p: DiscountPlanRecord & { shop_id: string }): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `INSERT OR REPLACE INTO discount_plans (id, name, discount_type, discount_value, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [p.id, p.name, p.discount_type, p.discount_value, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
    );
  } catch (err) {
    console.error('[OfflineDB] saveDiscountPlan error:', err);
    throw err;
  }
}

export async function bulkSaveDiscountPlans(plans: (DiscountPlanRecord & { shop_id: string })[]): Promise<void> {
  if (Platform.OS === 'web' || plans.length === 0) return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.withTransactionAsync(async () => {
      for (const p of plans) {
        await localDb.runAsync(
          `INSERT OR REPLACE INTO discount_plans (id, name, discount_type, discount_value, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [p.id, p.name, p.discount_type, p.discount_value, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
        );
      }
    });
  } catch (err) {
    console.error('[OfflineDB] bulkSaveDiscountPlans error:', err);
    throw err;
  }
}

export async function clearDiscountPlans(): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`DELETE FROM discount_plans;`);
  } catch (err) {
    console.error('[OfflineDB] clearDiscountPlans error:', err);
    throw err;
  }
}

export async function getDiscountPlans(shopId?: string | null): Promise<DiscountPlanRecord[]> {
  if (Platform.OS === 'web') return [];
  const localDb = getDb();
  if (!localDb) return [];
  try {
    let query = `SELECT * FROM discount_plans WHERE status = 'active'`;
    const params: any[] = [];
    if (shopId) {
      query += ` AND shop_id = ?`;
      params.push(shopId);
    }
    const rows = await localDb.getAllAsync(query, params);
    return rows as DiscountPlanRecord[];
  } catch (e) {
    console.warn('[OfflineDB] getDiscountPlans error:', e);
    return [];
  }
}

export async function savePricingPlan(p: PricingPlanRecord & { shop_id: string }): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `INSERT OR REPLACE INTO pricing_plans (id, name, description, price_multiplier, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [p.id, p.name, p.description || null, p.price_multiplier, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
    );
  } catch (err) {
    console.error('[OfflineDB] savePricingPlan error:', err);
    throw err;
  }
}

export async function bulkSavePricingPlans(plans: (PricingPlanRecord & { shop_id: string })[]): Promise<void> {
  if (Platform.OS === 'web' || plans.length === 0) return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.withTransactionAsync(async () => {
      for (const p of plans) {
        await localDb.runAsync(
          `INSERT OR REPLACE INTO pricing_plans (id, name, description, price_multiplier, applicable_to, target_id, target_name, status, start_date, end_date, shop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [p.id, p.name, p.description || null, p.price_multiplier, p.applicable_to, p.target_id || null, p.target_name || null, p.status, p.start_date, p.end_date, p.shop_id]
        );
      }
    });
  } catch (err) {
    console.error('[OfflineDB] bulkSavePricingPlans error:', err);
    throw err;
  }
}

export async function clearPricingPlans(): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`DELETE FROM pricing_plans;`);
  } catch (err) {
    console.error('[OfflineDB] clearPricingPlans error:', err);
    throw err;
  }
}

export async function getPricingPlans(shopId?: string | null): Promise<PricingPlanRecord[]> {
  if (Platform.OS === 'web') return [];
  const localDb = getDb();
  if (!localDb) return [];
  try {
    let query = `SELECT * FROM pricing_plans WHERE status = 'active'`;
    const params: any[] = [];
    if (shopId) {
      query += ` AND shop_id = ?`;
      params.push(shopId);
    }
    const rows = await localDb.getAllAsync(query, params);
    return rows as PricingPlanRecord[];
  } catch (e) {
    console.warn('[OfflineDB] getPricingPlans error:', e);
    return [];
  }
}

export async function saveReceiptDesign(d: ReceiptDesignRecord): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `INSERT OR REPLACE INTO receipt_designs (id, shop_id, header, footer, receipt_size, auto_print, styled_header, cash_drawer, printer_name, print_mode, extra_space, drawer_cmds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        d.id, 
        d.shop_id || null, 
        d.header || null, 
        d.footer || null, 
        d.receipt_size,
        d.auto_print ? 1 : 0,
        d.styled_header ? 1 : 0,
        d.cash_drawer ? 1 : 0,
        d.printer_name || null,
        d.print_mode || null,
        d.extra_space || null,
        d.drawer_cmds || null
      ]
    );
  } catch (err) {
    console.error('[OfflineDB] saveReceiptDesign error:', err);
    throw err;
  }
}

export async function getReceiptDesign(shopId?: string | null): Promise<ReceiptDesignRecord | null> {
  if (Platform.OS === 'web') return null;
  const localDb = getDb();
  if (!localDb) return null;
  try {
    let query = `SELECT * FROM receipt_designs`;
    const params: any[] = [];
    if (shopId) {
      query += ` WHERE shop_id = ? OR id = 'default'`;
      params.push(shopId);
      query += ` ORDER BY shop_id DESC LIMIT 1;`;
    } else {
      query += ` LIMIT 1;`;
    }
    const row = await localDb.getFirstAsync(query, params) as any;
    if (!row) return null;
    return {
      ...row,
      auto_print: row.auto_print === 1,
      styled_header: row.styled_header === 1,
      cash_drawer: row.cash_drawer === 1,
      print_mode: row.print_mode || 'Text',
      extra_space: row.extra_space || '10mm',
      drawer_cmds: row.drawer_cmds || '1B,70,00,3C,FF',
    } as ReceiptDesignRecord;
  } catch (e) {
    console.warn('[OfflineDB] getReceiptDesign error:', e);
    return null;
  }
}

// --- Employee functions ---

export async function saveEmployee(emp: EmployeeRecord): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `INSERT OR REPLACE INTO employees (employee_id, first_name, last_name, role, shop, pin, status) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [emp.employee_id, emp.first_name, emp.last_name, emp.role, emp.shop, emp.pin, emp.status]
    );
  } catch (err) {
    console.error('[OfflineDB] saveEmployee error:', err);
    throw err;
  }
}

export async function bulkSaveEmployees(employees: EmployeeRecord[]): Promise<void> {
  if (Platform.OS === 'web' || employees.length === 0) return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.withTransactionAsync(async () => {
      for (const emp of employees) {
        await localDb.runAsync(
          `INSERT OR REPLACE INTO employees (employee_id, first_name, last_name, role, shop, pin, status) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [emp.employee_id, emp.first_name, emp.last_name, emp.role, emp.shop, emp.pin, emp.status]
        );
      }
    });
  } catch (err) {
    console.error('[OfflineDB] bulkSaveEmployees error:', err);
    throw err;
  }
}

export async function getEmployeeByPin(pin: string): Promise<EmployeeRecord | null> {
  if (Platform.OS === 'web') return null;
  const localDb = getDb();
  if (!localDb) return null;
  try {
    const row = await localDb.getFirstAsync(
      `SELECT * FROM employees WHERE pin = ? AND status = 'active' LIMIT 1;`,
      [pin]
    );
    return (row as EmployeeRecord) || null;
  } catch (e) {
    console.warn('[OfflineDB] getEmployeeByPin error:', e);
    return null;
  }
}

export async function getEmployeeById(id: string): Promise<EmployeeRecord | null> {
  if (Platform.OS === 'web') return null;
  const localDb = getDb();
  if (!localDb) return null;
  try {
    const row = await localDb.getFirstAsync(
      `SELECT * FROM employees WHERE employee_id = ? LIMIT 1;`,
      [id]
    );
    return (row as EmployeeRecord) || null;
  } catch (e) {
    console.warn('[OfflineDB] getEmployeeById error:', e);
    return null;
  }
}

export async function clearEmployees(): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`DELETE FROM employees;`);
  } catch (err) {
    console.error('[OfflineDB] clearEmployees error:', err);
    throw err;
  }
}

// --- Access Log functions ---

export async function queueAccessLog(log: Omit<OfflineAccessLog, 'id' | 'synced' | 'logout_time'>): Promise<string> {
  if (Platform.OS === 'web') return 'web-id';
  const localDb = getDb();
  if (!localDb) return 'no-db';
  try {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    await localDb.runAsync(
      `INSERT INTO access_logs_queue (id, employee_id, shop_id, login_time, synced) VALUES (?, ?, ?, ?, 0);`,
      [id, log.employee_id, log.shop_id, log.login_time]
    );
    return id;
  } catch (err) {
    console.error('[OfflineDB] queueAccessLog error:', err);
    throw err;
  }
}
export async function deductStockLocally(items: { product_id: string, quantity: number }[]): Promise<void> {
  if (Platform.OS === 'web' || items.length === 0) return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.withTransactionAsync(async () => {
      for (const item of items) {
        // Use MAX(0, in_stock - ?) to ensure stock doesn't go negative
        await localDb.runAsync(
          `UPDATE products SET in_stock = MAX(0, in_stock - ?) WHERE id = ?;`,
          [item.quantity, item.product_id]
        );
      }
    });
    console.debug(`[OfflineDB] Deducted stock for ${items.length} items.`);
  } catch (err) {
    console.error('[OfflineDB] deductStockLocally error:', err);
    throw err;
  }
}

export async function updateAccessLogLogout(id: string, logoutTime: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(
      `UPDATE access_logs_queue SET logout_time = ? WHERE id = ?;`,
      [logoutTime, id]
    );
  } catch (err) {
    console.error('[OfflineDB] updateAccessLogLogout error:', err);
    throw err;
  }
}

export async function getPendingAccessLogs(): Promise<OfflineAccessLog[]> {
  if (Platform.OS === 'web') return [];
  const localDb = getDb();
  if (!localDb) return [];
  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM access_logs_queue WHERE synced = 0;`);
    return rows.map((r: any) => ({ ...r, synced: r.synced === 1 })) as OfflineAccessLog[];
  } catch (err) {
    console.error('[OfflineDB] getPendingAccessLogs error:', err);
    return [];
  }
}

export async function markAccessLogSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`UPDATE access_logs_queue SET synced = 1 WHERE id = ?;`, [id]);
  } catch (err) {
    console.error('[OfflineDB] markAccessLogSynced error:', err);
    throw err;
  }
}

/**
 * Calculates total quantity sold per product for all un-synced sales.
 */
export async function getPendingDeductions(): Promise<Record<string, number>> {
  const pending = await getPendingSales();
  const deductions: Record<string, number> = {};
  
  for (const sale of pending) {
    const items = sale.data?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const pid = item.product_id || item.id;
        const qty = Number(item.quantity || 0);
        if (pid) {
          deductions[pid] = (deductions[pid] || 0) + qty;
        }
      }
    }
  }
  
  return deductions;
}
