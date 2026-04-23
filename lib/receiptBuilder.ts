/**
 * receiptBuilder.ts
 *
 * Builds a fully-formatted ESC/POS text receipt from:
 *  - A ReceiptData payload (sale details)
 *  - A ReceiptDesign record loaded from the offline SQLite database
 *
 * The ESC/POS markup used here is compatible with the dantsu/ESCPOS-ThermalPrinter-Android library:
 *  [C] = center, [L] = left, [R] = right
 *  <b>text</b> = bold, <font size='big'>text</font> = large font
 *  [C]-------------------------------- = dashed divider line
 */

import { Platform } from 'react-native';
import { getReceiptDesign, ReceiptDesignRecord } from '@/lib/offlineDb';

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptPayload {
  orderId: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod?: string;
  employeeName?: string;
  createdAt?: string;
  shopId?: string | null;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const t = text.slice(0, width);
  return align === 'left' ? t.padEnd(width) : t.padStart(width);
}

function twoCol(left: string, right: string, width = 32): string {
  const gap = width - left.length - right.length;
  if (gap <= 0) return `${left.slice(0, width - right.length - 1)} ${right}`;
  return `${left}${' '.repeat(gap)}${right}`;
}

function fmtPrice(val: number): string {
  return `$${val.toFixed(2)}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

// ─── Default design (fallback if no offline design row exists) ─────────────────

const DEFAULT_DESIGN: Omit<ReceiptDesignRecord, 'id' | 'shop_id'> = {
  header: 'THANK YOU FOR SHOPPING',
  footer: 'Please keep this receipt for your records.\nWe appreciate your business!',
  receipt_size: '58mm',
};

// ─── Core Builder ──────────────────────────────────────────────────────────────

export async function buildReceipt(payload: ReceiptPayload): Promise<{
  formattedText: string;
  widthMM: number;
  charsPerLine: number;
}> {
  // 1. Load design from offline DB (falls back to default if not found)
  let design: Omit<ReceiptDesignRecord, 'id' | 'shop_id'> = DEFAULT_DESIGN;

  if (Platform.OS !== 'web') {
    try {
      const saved = await getReceiptDesign(payload.shopId);
      if (saved) {
        design = saved;
      }
    } catch (err) {
      console.warn('[ReceiptBuilder] Could not load offline design, using default:', err);
    }
  }

  const is80mm = design.receipt_size === '80mm';
  const lineWidth = is80mm ? 48 : 32;
  const divider = '-'.repeat(lineWidth);

  const lines: string[] = [];

  // ── HEADER ──
  if (design.header) {
    design.header.split('\n').forEach(line => {
      lines.push(`[C]<b>${line.trim()}</b>`);
    });
  }

  lines.push(`[C]${fmtDate(payload.createdAt)}`);
  lines.push(`[C]${divider}`);

  // ── SALE INFO ──
  lines.push(`[L]Invoice: [R]#${payload.orderId.slice(-8).toUpperCase()}`);
  if (payload.employeeName) {
    lines.push(`[L]Cashier: [R]${payload.employeeName}`);
  }
  lines.push(`[C]${divider}`);

  // ── ITEMS HEADER ──
  lines.push(`[L]<b>Item</b>[R]<b>Amt</b>`);
  lines.push(`[C]${divider}`);

  // ── ITEMS ──
  let totalQty = 0;
  for (const item of payload.items) {
    totalQty += item.quantity;
    const lineTotal = item.quantity * item.price;
    // Item name on its own line (truncated if needed)
    lines.push(`[L]${item.name.slice(0, lineWidth - 1)}`);
    // Detail: qty × price → subtotal right-aligned
    lines.push(`[L]  ${item.quantity} x ${fmtPrice(item.price)}[R]${fmtPrice(lineTotal)}`);
  }

  lines.push(`[C]${divider}`);

  // ── TOTALS ──
  lines.push(`[L]Items:[R]${totalQty}`);

  if (payload.discount && payload.discount > 0) {
    lines.push(`[L]Subtotal:[R]${fmtPrice(payload.subtotal)}`);
    lines.push(`[L]Discount:[R]-${fmtPrice(payload.discount)}`);
  }

  // Grand Total — big and bold
  lines.push(`[L]<b><font size='big'>TOTAL:</font></b>[R]<b><font size='big'>${fmtPrice(payload.total)}</font></b>`);

  if (payload.paymentMethod) {
    lines.push(`[L]Payment:[R]${payload.paymentMethod}`);
  }

  lines.push(`[C]${divider}`);

  // ── FOOTER ──
  if (design.footer) {
    design.footer.split('\n').forEach(line => {
      lines.push(`[C]${line.trim()}`);
    });
  }

  // Trailing feed for clean cut
  lines.push('');
  lines.push('');
  lines.push('');

  return {
    formattedText: lines.join('\n'),
    widthMM: is80mm ? 80 : 48, // 48mm is the printable width for 58mm paper usually
    charsPerLine: lineWidth,
  };
}
