# Offline-First POS App - Implementation Summary

## Overview

This document outlines the implementation of an offline-first data layer, retail-only checkout flow, and local sales queue management for the POS Android app using Expo, SQLite (via expo-sqlite), and Supabase.

---

## 1. Global App Settings & Shop ID Integration

### Files Modified:
- **`lib/settings.ts`** (new)
  - `setShopId(id: string | null)`: Persist Shop ID to AsyncStorage
  - `getShopId()`: Retrieve stored Shop ID

### How It Works:
- Shop ID is stored in AsyncStorage under the key `shop_id`
- Used by the sync layer to target the correct row in `store_inventory` when calling the `deduct_stock` RPC
- Users can update their Shop ID in the Settings screen

### Settings Screen Integration:
- Added a new "Shop Information" section at the top of `app/settings.tsx`
- Input field to set/update Shop ID
- "Set" button to persist the value

---

## 2. Offline Data Layer & Room Cache (SQLite)

### Files Created:
- **`lib/offlineDb.ts`**
  - Database initialization and schema creation
  - Products table: `products` (id, name, price, category, image_url)
  - Inventory table: `store_inventory` (id, product_id, quantity, shop_id)
  - **Sales Queue table: `sales_queue`** (id, data (JSON), synced (0/1), created_at)

### Key Functions:
- `initDb()`: Creates tables if they don't exist
- `queueSale(sale)`: Insert a sale record locally (always synced=0)
- `getPendingSales()`: Fetch all unsynchronized sales
- `getAllSales()`: Fetch all sales (synced and pending)
- `markSaleSynced(id)`: Mark a sale as synced after Supabase upload

### Integration:
- Database is initialized in `app/_layout.tsx` on app startup via `initDb()`

---

## 3. Background Sync with WorkManager & Connectivity Detection

### Files Created:
- **`lib/sync.ts`**
  - `initSync()`: Sets up connectivity listener using `@react-native-community/netinfo`
  - `syncSalesQueue()`: Syncs pending sales to Supabase when online

### How It Works:
1. **Connectivity Detection**: Listens for network status changes
2. **Auto-Sync on Reconnect**: When device regains internet, `syncSalesQueue()` is triggered
3. **Per-Sale Processing**:
   - Each pending sale is inserted to `transaction_receipts` in Supabase
   - Calls `deduct_stock` RPC with the saved Shop ID
   - Marks the sale as synced on success; leaves it pending on failure
4. **Graceful Degradation**: Errors are logged but don't halt the sync process

### Integration:
- Sync is initialized in `app/_layout.tsx` via `initSync()`
- Manual sync refresh available from the Sales Queue screen

---

## 4. UI Changes: Restaurant Feature Removal & Retail-Only Mode

### Changes to `app/pos.tsx`:

#### Removed:
- `OrderType` enum and `ORDER_TYPES` array (was `['Dine In', 'Take Away', 'Delivery']`)
- Order type selector UI component (`orderTypeRow` and related styles)

#### Updated `handleCharge()`:
- Sales are **always** queued locally first via `queueSale()`
- Syncing is triggered via `syncSalesQueue()` (both immediate and continuous on connectivity)
- Receipt shows hard-coded `'RETAIL'` as order type
- Print attempt is non-blocking (errors are silently caught)

#### Added Pending Counter:
- `pendingCount` state tracks unsynced sales
- Badge displays near printer status showing "X pending"
- `refreshPending()` updates count after charging

### Changes to Receipt HTML (`lib/receiptHtml.ts`):
- Made `orderType` optional (defaults to `'RETAIL'`)
- Updated template to show `'RETAIL'` label

---

## 5. Status Indicators & Void Feature

### Status Indicators Added:
- **Pending Badge**: Shows count of unsynchronized sales in the cart panel
- **Sales Queue Screen**: Lists all sales with sync status (Synced/Pending)
  - Located at new `app/sales.tsx` screen
  - Accessible from sidebar menu
  - Shows order ID, date/time, and sync status
  - Manual sync refresh button

### Void Feature:
- **Clear Order / Void Button**: New button in cart footer
- **Behavior**: 
  - Clears cart via `clearCart()`
  - **No database calls** or receipt generation
  - Haptic feedback (warning tone)
  - Styled to match dark theme with red/danger colors
  - Only appears when cart has items

### New Screen: `app/sales.tsx`
- View all local sales (pending and synced)
- Shows: Order ID, timestamp, sync status
- Manual refresh/sync button
- Styled to match POS interface

### Sidebar Integration:
- Added "Sales" menu item linking to `/sales` screen
- Accessible alongside Products, Reports, Settings

---

## 6. New Dependencies Added

Update `package.json` with:
```json
"@react-native-community/netinfo": "^9.3.0",
"expo-sqlite": "~11.0.0"
```

**All other dependencies** (AsyncStorage, Haptics, React Query, Supabase) were already present.

---

## 7. Updated App Navigation

### File: `app/_layout.tsx`
- Added `initDb()` and `initSync()` calls on mount
- Registered new `sales` screen in the navigation stack

### File: `app/pos.tsx`
- Sidebar now includes "Sales" menu item
- Removed restaurant-specific order type UI

---

## 8. Database & Sync Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Charge Button Pressed                  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │  Queue Sale Locally (SQLite) │
        └────────────┬─────────────────┘
                     │
                     ▼
       ┌────────────────────────────────┐
       │  Attempt Immediate Sync (if    │
       │  online & Supabase available)  │
       └────────────┬───────────────────┘
                    │
      ┌─────────────┴──────────────┐
      │ Online?                    │
      ▼                            ▼
   ┌─────────┐                 ┌────────┐
   │ SYNC    │                 │ PEND   │
   └────┬────┘                 └────┬───┘
        │                           │
        ▼                           ▼
   Insert to         ┌──────────────────────┐
   transaction_      │ Listen for           │
   receipts +        │ Network Reconnection │
   deduct_stock      └──────┬───────────────┘
   RPC               Regains│Connection
                           ▼
                      SYNC PENDING QUEUE
```

---

## 9. Data Format: Sales Queue

Local sales are stored as JSON in the `sales_queue` table:

```json
{
  "orderId": "168932948234",
  "items": [
    { "name": "Bread", "quantity": 2, "price": 2.50 },
    { "name": "Cheese Slices", "quantity": 1, "price": 7.50 }
  ],
  "subtotal": 12.50,
  "discount": 0,
  "tax": 0.625,
  "total": 13.125,
  "createdAt": "2025-03-03T14:30:15.000Z"
}
```

When synced to Supabase, this becomes a row in `transaction_receipts` table.

---

## 10. Configuration & Next Steps

### Supabase RPC Function Required:
You must create this RPC in Supabase to handle stock deductions:

```sql
CREATE OR REPLACE FUNCTION deduct_stock(
  shop_id TEXT,
  items JSONB
) RETURNS void AS $$
BEGIN
  -- Implementation: For each item in the JSON array,
  -- decrement quantity in store_inventory where shop_id matches
  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    UPDATE store_inventory
    SET quantity = quantity - (item->>'quantity')::INT
    WHERE shop_id = deduct_stock.shop_id
      AND product_id = item->>'product_id';
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### Migration Steps:
1. Run `npm install` to fetch new dependencies
2. Deploy the `deduct_stock` RPC to your Supabase project
3. Set your Shop ID in Settings before first use
4. Test checkout flow offline and online

### Testing Checklist:
- [ ] Set Shop ID in Settings
- [ ] Add items to cart and charge while offline
- [ ] Verify sale is queued (shown in Sales Queue)
- [ ] Reconnect to internet
- [ ] Verify sale syncs automatically or via refresh button
- [ ] Check Supabase `transaction_receipts` and `store_inventory` updates
- [ ] Test Void button (clears cart without saving)
- [ ] Verify all restaurant UI elements are removed

---

## 11. File Structure Summary

```
app/
  _layout.tsx                   (modified: initDB, initSync)
  pos.tsx                        (modified: retail-only, void, pending badge)
  settings.tsx                   (modified: shop ID input)
  sales.tsx                      (new: sales queue viewer)

lib/
  settings.ts                    (new: Shop ID storage)
  offlineDb.ts                   (new: SQLite schema & functions)
  sync.ts                        (new: Sync logic & connectivity)
  receiptHtml.ts                 (modified: optional orderType)

constants/
  colors.ts                      (modified: added warningDim)

package.json                     (modified: added netinfo, expo-sqlite)
```

---

## 12. Troubleshooting

| Issue | Solution |
|-------|----------|
| Sales not syncing | Check network connectivity, verify Shop ID is set, check Supabase logs |
| Pending badge doesn't update | Manually trigger refresh from Sales Queue screen |
| Print errors are silent | This is by design; sales are queued even if print fails |
| Missing `expo-sqlite` types | Run `npm install` after adding dependencies |
| Stock RPC not working | Verify RPC exists in Supabase and has correct signature |

---

## Summary

The POS app is now **offline-first**, with:
✅ Local SQLite queue for sales  
✅ Automatic background sync when online  
✅ Shop ID tracking for inventory management  
✅ Retail-only UI (no restaurant features)  
✅ Void/Clear sale functionality  
✅ Synced/Pending status tracking  
✅ Manual and automatic sync triggers  

Users can now operate the app offline and all transactions will be queued and synced once connectivity returns.
