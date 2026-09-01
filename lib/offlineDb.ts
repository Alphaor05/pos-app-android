import { Platform, Alert } from 'react-native';
import * as Crypto from 'expo-crypto';

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
  last_attempt_at?: string | null;
  created_at: string;
}

// web queue persisted to localStorage so a reload never silently loses unsynced sales
const WEB_QUEUE_KEY = 'pos_web_queue';

function loadWebQueue(): SaleRecord[] {
  if (Platform.OS !== 'web') return [];
  try {
    const stored = (globalThis as any).localStorage?.getItem(WEB_QUEUE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[OfflineDB] Failed to restore web queue from localStorage:', e);
    return [];
  }
}

function persistWebQueue() {
  if (Platform.OS !== 'web') return;
  try {
    (globalThis as any).localStorage?.setItem(WEB_QUEUE_KEY, JSON.stringify(webQueue));
  } catch (e) {
    console.warn('[OfflineDB] Failed to persist web queue:', e);
  }
}

let webQueue: SaleRecord[] = loadWebQueue();

export interface ProductRecord {
  id: string;
  name: string;
  price: number;
  category?: string;
  image_url?: string;
  in_stock?: number;
  shop_id?: string | null;
  allow_negative_stock?: number | boolean;
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

const WEB_PRODUCTS_KEY = 'pos_products_cache';

function getWebProducts(shopId?: string | null): ProductRecord[] {
  try {
    const raw = (globalThis as any).localStorage?.getItem(WEB_PRODUCTS_KEY);
    if (!raw) return [];
    const cached = JSON.parse(raw);
    const products: ProductRecord[] = Array.isArray(cached?.products) ? cached.products : [];
    if (!shopId) return products;
    return cached?.shopId === shopId ? products : [];
  } catch (e) {
    console.warn('[OfflineDB] getWebProducts error:', e);
    return [];
  }
}

function setWebProducts(products: ProductRecord[], shopId?: string | null): void {
  if (Platform.OS !== 'web') return;
  try {
    (globalThis as any).localStorage?.setItem(
      WEB_PRODUCTS_KEY,
      JSON.stringify({ shopId: shopId ?? null, products })
    );
  } catch (e) {
    console.warn('[OfflineDB] Failed to persist web products:', e);
  }
}

/**
 * Load cached products for a shop. When the shop has its own cached bucket it
 * returns that; otherwise it falls back to the global bucket (shop_id IS NULL)
 * so an offline-first device that has never fetched this shop's stock still
 * shows a usable catalog.
 */
export async function getProducts(shopId?: string | null): Promise<ProductRecord[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve(getWebProducts(shopId));
  }
  const localDb = getDb();
  if (!localDb) return [];
  try {
    if (shopId) {
      const rows = await localDb.getAllAsync(
        `SELECT * FROM products WHERE shop_id = ? ORDER BY name ASC;`,
        [shopId]
      );
      if (rows.length > 0) return rows as ProductRecord[];
      return (await localDb.getAllAsync(
        `SELECT * FROM products WHERE shop_id IS NULL ORDER BY name ASC;`
      )) as ProductRecord[];
    }
    return (await localDb.getAllAsync(
      `SELECT * FROM products WHERE shop_id IS NULL ORDER BY name ASC;`
    )) as ProductRecord[];
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
      `INSERT OR REPLACE INTO products (id, name, price, category, image_url, in_stock, shop_id, allow_negative_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [p.id, p.name, p.price, p.category || null, p.image_url || null, p.in_stock ?? 9999, p.shop_id ?? null, p.allow_negative_stock ? 1 : 0]
    );
  } catch (err) {
    console.error('[OfflineDB] addProduct error:', err);
    throw err;
  }
}

/**
 * Bulk insert products within a single transaction for maximum performance.
 * Replaces ONLY the cache bucket for the given shop (or the global bucket when
 * shopId is null), so a fetch for one shop can never clobber another shop's
 * cached catalog.
 *
 * Safety invariant: an EMPTY product list never clears an existing bucket.
 * Products that have been downloaded are kept until a complete replacement
 * arrives — a transient empty/truncated server response can't make the offline
 * catalog disappear.
 */
export async function bulkAddProducts(products: ProductRecord[], shopId?: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (products.length === 0) return;
    setWebProducts(products, shopId);
    return;
  }
  const localDb = getDb();
  if (!localDb) return;

  // Never wipe a shop's cached catalog because the server returned nothing.
  if (products.length === 0) return;

  const key = shopId ?? null;

  try {
    await localDb.withTransactionAsync(async () => {
      if (key === null) {
        await localDb.runAsync(`DELETE FROM products WHERE shop_id IS NULL;`);
      } else {
        await localDb.runAsync(`DELETE FROM products WHERE shop_id = ?;`, [key]);
      }
      // Batch inserts into multi-row statements (100 per statement) instead of
      // issuing one runAsync per product — dramatically faster cache rebuilds,
      // which matter when two tablets are invalidating each other's caches.
      const CHUNK = 100;
      for (let i = 0; i < products.length; i += CHUNK) {
        const slice = products.slice(i, i + CHUNK);
        const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params: any[] = [];
        for (const p of slice) {
          params.push(
            p.id, p.name, p.price, p.category || null, p.image_url || null,
            p.in_stock ?? 9999, key, p.allow_negative_stock ? 1 : 0
          );
        }
        await localDb.runAsync(
          `INSERT OR REPLACE INTO products (id, name, price, category, image_url, in_stock, shop_id, allow_negative_stock) VALUES ${placeholders};`,
          params
        );
      }
    });
  } catch (err) {
    console.error('[OfflineDB] bulkAddProducts error:', err);
    throw err;
  }
}

export async function clearProducts(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      (globalThis as any).localStorage?.removeItem(WEB_PRODUCTS_KEY);
    } catch (e) {
      console.warn('[OfflineDB] clearWebProducts error:', e);
    }
    return;
  }
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
        id TEXT NOT NULL,
        name TEXT,
        price REAL,
        category TEXT,
        image_url TEXT,
        in_stock INTEGER DEFAULT 9999,
        shop_id TEXT,
        PRIMARY KEY (id, shop_id)
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

    // Migration: products cache is now per-shop. Rebuild the table with a
    // composite primary key (id, shop_id) so a product can have a row for
    // multiple shops. Existing rows become the "global" bucket (shop_id NULL).
    try {
      const productTableInfo = localDb.getAllSync(`PRAGMA table_info(products);`);
      const hasShopId = productTableInfo.some((c: any) => c.name === 'shop_id');
      if (!hasShopId) {
        localDb.execSync(`
          CREATE TABLE products_new (
            id TEXT NOT NULL,
            name TEXT,
            price REAL,
            category TEXT,
            image_url TEXT,
            in_stock INTEGER DEFAULT 9999,
            shop_id TEXT,
            PRIMARY KEY (id, shop_id)
          );
          INSERT INTO products_new (id, name, price, category, image_url, in_stock, shop_id)
            SELECT id, name, price, category, image_url, in_stock, NULL FROM products;
          DROP TABLE products;
          ALTER TABLE products_new RENAME TO products;
        `);
      }
    } catch (e) {
      console.warn('Migration for products.shop_id failed:', e);
    }

    // Migration: add allow_negative_stock column for products that can oversell
    try {
      const productTableInfo = localDb.getAllSync(`PRAGMA table_info(products);`);
      const hasAllowNegative = productTableInfo.some((c: any) => c.name === 'allow_negative_stock');
      if (!hasAllowNegative) {
        localDb.execSync(`ALTER TABLE products ADD COLUMN allow_negative_stock INTEGER DEFAULT 0;`);
      }
    } catch (e) {
      console.warn('Migration for products.allow_negative_stock failed:', e);
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
        last_attempt_at TEXT,
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
      if (!columns.includes('last_attempt_at')) {
        localDb.execSync(`ALTER TABLE sales_queue ADD COLUMN last_attempt_at TEXT;`);
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

    localDb.execSync(`
      CREATE TABLE IF NOT EXISTS messages_queue (
        id TEXT PRIMARY KEY,
        data TEXT,
        synced INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        created_at TEXT
      );
    `);

    // seed a couple items if products table is empty
    const countRow = localDb.getFirstSync(`SELECT COUNT(*) as c FROM products;`);
    if (countRow && (countRow as any).c === 0) {
      // Removed sample products to prevent ID collisions with real Supabase data
      const samples: any[] = [];
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


/**
 * Generate a globally unique ID for sales.
 * The hex timestamp prefix is for readability/traceability only — uniqueness
 * comes from the appended version-4 UUID, which has 122 random bits.
 * Collision probability is ~2^-122 per id: effectively impossible across every
 * shop, cashier, terminal, date and time, and the space can never be exhausted.
 */
export function generateSaleId(): string {
  return `${Date.now().toString(16)}-${Crypto.randomUUID()}`;
}

/**
 * Validates a sale record before persisting.
 * Throws with a user-friendly message if invalid.
 */
function validateSale(sale: any): void {
  if (!sale) throw new Error('Sale record is empty');
  if (!sale.orderId) throw new Error('Sale is missing an order ID');
  if (typeof sale.total !== 'number' || isNaN(sale.total)) {
    throw new Error('Sale total is not a valid number');
  }
  if (sale.total <= 0) {
    throw new Error('Sale total must be greater than zero');
  }
  if (!Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error('Sale has no items');
  }
}

export async function queueSale(sale: any): Promise<void> {
  if (Platform.OS === 'web') {
    const id = sale.orderId || generateSaleId();
    const rec: SaleRecord = {
      id,
      data: sale,
      synced: false,
      created_at: new Date().toISOString(),
    };
    webQueue.push(rec);
    persistWebQueue();
    return;
  }

  validateSale(sale);

  const localDb = getDb();
  if (!localDb) return;

  try {
    const id = sale.orderId || generateSaleId();
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

/**
 * Atomically queues a sale AND deducts stock in a single SQLite transaction.
 * If either operation fails, both are rolled back — preventing inconsistent state.
 *
 * Returns the id of the recorded sale. Idempotent: if a sale with the same
 * order id is already queued, it is treated as already recorded and stock is
 * NOT deducted a second time.
 */
export async function queueSaleAtomically(
  sale: any,
  stockItems: { product_id: string; quantity: number }[]
): Promise<string> {
  if (Platform.OS === 'web') {
    await queueSale(sale);
    return sale.orderId || generateSaleId();
  }

  validateSale(sale);

  const localDb = getDb();
  if (!localDb) throw new Error('Database not available');

  const id = sale.orderId || generateSaleId();
  const dataStr = JSON.stringify(sale);
  const created = new Date().toISOString();

  try {
    await localDb.withTransactionAsync(async () => {
      // 1. Insert the sale (INSERT OR IGNORE keeps this idempotent: if the
      //    order id already exists, skip re-insert AND skip stock deduction)
      const result = await localDb.runAsync(
        `INSERT OR IGNORE INTO sales_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
        [id, dataStr, 0, created]
      );
      if (result && (result as any).changes === 0) return;

      // 2. Deduct stock for each item. With the per-shop cache (composite PK
      //    id+shop_id) the deduction MUST be scoped to the sale's shop, or it
      //    would wrongly reduce stock in every other shop's cached bucket.
      //    The global (shop_id IS NULL) bucket is updated too so pre-upgrade
      //    caches stay consistent as the offline fallback source.
      for (const item of stockItems) {
        if (sale.shopId) {
          await localDb.runAsync(
            `UPDATE products SET in_stock = CASE WHEN allow_negative_stock = 1 THEN in_stock - ? ELSE MAX(0, in_stock - ?) END WHERE id = ? AND shop_id = ?;`,
            [item.quantity, item.quantity, item.product_id, sale.shopId]
          );
        }
        await localDb.runAsync(
          `UPDATE products SET in_stock = CASE WHEN allow_negative_stock = 1 THEN in_stock - ? ELSE MAX(0, in_stock - ?) END WHERE id = ? AND shop_id IS NULL;`,
          [item.quantity, item.quantity, item.product_id]
        );
      }
    });
    console.log(`[OfflineDB] Sale ${id} queued + stock deducted atomically.`);
    return id;
  } catch (err) {
    console.error(`[OfflineDB] Atomic sale+stock failed for ${id}:`, err);
    throw err;
  }
}

/**
 * Safely parses a single sale row's JSON data.
 * Returns null for corrupt rows instead of crashing the entire query.
 */
function parseSaleRow(r: any): SaleRecord | null {
  try {
    return {
      id: r.id,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      synced: r.synced === 1,
      sync_attempts: r.sync_attempts || 0,
      last_error: r.last_error || null,
      last_attempt_at: r.last_attempt_at || null,
      created_at: r.created_at,
    };
  } catch (e) {
    console.error(`[OfflineDB] Corrupt sale row ${r?.id}, skipping:`, e);
    return null;
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
    const results: SaleRecord[] = [];
    for (const r of rows) {
      const parsed = parseSaleRow(r);
      if (parsed) results.push(parsed);
    }
    return results;
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
    const results: SaleRecord[] = [];
    let corruptCount = 0;
    for (const r of rows) {
      const parsed = parseSaleRow(r);
      if (parsed) {
        results.push(parsed);
      } else {
        corruptCount++;
      }
    }
    if (corruptCount > 0) {
      console.warn(`[OfflineDB] ${corruptCount} corrupt sale row(s) were skipped in getAllSales.`);
    }
    return results;
  } catch (err) {
    console.error('[OfflineDB] getAllSales error:', err);
    return [];
  }
}

/**
 * Counts sales_queue rows whose stored JSON is unreadable.
 * Corrupt rows are invisible to sync, reports and the sales screen, so this
 * lets the UI warn an admin that the device holds unrecoverable records.
 */
export async function countCorruptSales(): Promise<number> {
  if (Platform.OS === 'web') return 0;
  const localDb = getDb();
  if (!localDb) return 0;
  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM sales_queue;`);
    let corrupt = 0;
    for (const r of rows) {
      if (!parseSaleRow(r)) corrupt++;
    }
    return corrupt;
  } catch (err) {
    console.error('[OfflineDB] countCorruptSales error:', err);
    return 0;
  }
}

/**
 * Deletes rows whose stored JSON is unreadable so they stop silently
 * occupying the queue. Returns how many were removed.
 */
export async function deleteCorruptSales(): Promise<number> {
  if (Platform.OS === 'web') return 0;
  const localDb = getDb();
  if (!localDb) return 0;
  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM sales_queue;`);
    const corruptIds: string[] = [];
    for (const r of rows) {
      if (!parseSaleRow(r)) corruptIds.push(r.id);
    }
    if (corruptIds.length === 0) return 0;
    const placeholders = corruptIds.map(() => '?').join(',');
    await localDb.runAsync(`DELETE FROM sales_queue WHERE id IN (${placeholders});`, corruptIds);
    console.log(`[OfflineDB] Deleted ${corruptIds.length} corrupt sale row(s).`);
    return corruptIds.length;
  } catch (err) {
    console.error('[OfflineDB] deleteCorruptSales error:', err);
    return 0;
  }
}

/**
 * Returns the full local sales queue as a JSON string for manual recovery
 * when normal sync is unavailable.
 */
export async function exportSalesQueue(): Promise<string> {
  const all = await getAllSales();
  return JSON.stringify({ exported_at: new Date().toISOString(), count: all.length, sales: all }, null, 2);
}

export async function markSaleSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    const rec = webQueue.find(r => r.id === id);
    if (rec) rec.synced = true;
    persistWebQueue();
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
    const lastAttemptAt = new Date().toISOString();
    await localDb.runAsync(
      `UPDATE sales_queue SET sync_attempts = ?, last_error = ?, last_attempt_at = ? WHERE id = ?;`,
      [attempts, error, lastAttemptAt, id]
    );
  } catch (err) {
    console.error('[OfflineDB] updateSaleSyncProgress error:', err);
  }
}

export async function deleteSaleFromQueue(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    const idx = webQueue.findIndex(r => r.id === id);
    if (idx !== -1) webQueue.splice(idx, 1);
    persistWebQueue();
    return;
  }

  const localDb = getDb();
  if (!localDb) return;
  try {
    await localDb.runAsync(`DELETE FROM sales_queue WHERE id = ?;`, [id]);
    console.log(`[OfflineDB] Deleted sale ${id} from queue.`);
  } catch (err) {
    console.error('[OfflineDB] deleteSaleFromQueue error:', err);
    throw err;
  }
}

export async function queueActivityLog(log: any): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    const id = generateSaleId();
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
    const id = generateSaleId();
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
        await localDb.runAsync(
          `UPDATE products SET in_stock = CASE WHEN allow_negative_stock = 1 THEN in_stock - ? ELSE MAX(0, in_stock - ?) END WHERE id = ?;`,
          [item.quantity, item.quantity, item.product_id]
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

// --- Cashier Message functions ---

export interface CashierMessageRecord {
  id: string;
  data: Record<string, any>;
  synced: boolean;
  sync_attempts?: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  created_at: string;
}

export const MESSAGE_CATEGORIES = ['Stock Issue', 'Order Request', 'Concern', 'Equipment', 'Other'] as const;

const MESSAGE_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Queues a cashier message locally. Returns the generated client_msg_id.
 * On web nothing is persisted here — the caller performs a direct insert
 * when a connection is available.
 *
 * Contract: employee_id must be a real UUID or null. Placeholder values
 * like 'system' are coerced to null because cashier_messages.employee_id
 * is a uuid column and would reject them.
 */
export async function queueMessage(msg: {
  shop_id?: string | null;
  message_text: string;
  category?: string;
  employee_id?: string | null;
  employee_name?: string | null;
  created_at?: string;
}): Promise<string> {
  const text = (msg.message_text || '').trim();
  if (!text) throw new Error('Message text is empty');

  const id = generateSaleId();
  const payload = {
    shop_id: msg.shop_id || null,
    message_text: text,
    category: msg.category || 'Other',
    employee_id: msg.employee_id && MESSAGE_UUID_REGEX.test(msg.employee_id) ? msg.employee_id : null,
    employee_name: msg.employee_name || null,
    created_at: msg.created_at || new Date().toISOString(),
  };

  if (Platform.OS === 'web') return id;

  const localDb = getDb();
  if (!localDb) return id;

  try {
    await localDb.runAsync(
      `INSERT INTO messages_queue (id, data, synced, created_at) VALUES (?, ?, ?, ?);`,
      [id, JSON.stringify(payload), 0, payload.created_at]
    );
    console.log(`[OfflineDB] Message ${id} queued for sync.`);
    return id;
  } catch (err) {
    console.error('[OfflineDB] queueMessage error:', err);
    throw err;
  }
}

export async function getPendingMessages(): Promise<CashierMessageRecord[]> {
  if (Platform.OS === 'web') return [];
  const localDb = getDb();
  if (!localDb) return [];

  try {
    const rows = await localDb.getAllAsync(`SELECT * FROM messages_queue WHERE synced = 0 ORDER BY created_at ASC;`);
    const results: CashierMessageRecord[] = [];
    for (const r of rows as any[]) {
      try {
        results.push({
          id: r.id,
          data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
          synced: r.synced === 1,
          sync_attempts: r.sync_attempts || 0,
          last_error: r.last_error || null,
          last_attempt_at: r.last_attempt_at || null,
          created_at: r.created_at,
        });
      } catch (e) {
        console.error(`[OfflineDB] Corrupt message row ${r?.id}, skipping:`, e);
      }
    }
    return results;
  } catch (err) {
    console.error('[OfflineDB] getPendingMessages error:', err);
    return [];
  }
}

export async function markMessageSynced(id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;

  try {
    await localDb.runAsync(
      `UPDATE messages_queue SET synced = 1 WHERE id = ?;`,
      [id]
    );
  } catch (err) {
    console.error('[OfflineDB] markMessageSynced error:', err);
    throw err;
  }
}

export async function updateMessageSyncProgress(id: string, attempts: number, error: string | null): Promise<void> {
  if (Platform.OS === 'web') return;
  const localDb = getDb();
  if (!localDb) return;
  try {
    const lastAttemptAt = new Date().toISOString();
    await localDb.runAsync(
      `UPDATE messages_queue SET sync_attempts = ?, last_error = ?, last_attempt_at = ? WHERE id = ?;`,
      [attempts, error, lastAttemptAt, id]
    );
  } catch (err) {
    console.error('[OfflineDB] updateMessageSyncProgress error:', err);
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

/**
 * Runs SQLite PRAGMA integrity_check on startup.
 * Returns true if the database is healthy, false if corruption is detected.
 * Logs a visible warning on corruption so admins are aware.
 */
export function checkDbIntegrity(): boolean {
  if (Platform.OS === 'web') return true;
  const localDb = getDb();
  if (!localDb) return true;

  try {
    const result = localDb.getFirstSync(`PRAGMA integrity_check;`) as any;
    const status = result?.integrity_check || result?.['integrity_check'] || 'unknown';
    if (status === 'ok') {
      console.log('[OfflineDB] Database integrity check passed.');
      return true;
    } else {
      console.error(`[OfflineDB] ⚠️ DATABASE CORRUPTION DETECTED: ${status}`);
      // Don't crash — let the app run but warn loudly
      return false;
    }
  } catch (e) {
    console.error('[OfflineDB] Integrity check failed to run:', e);
    return false;
  }
}
