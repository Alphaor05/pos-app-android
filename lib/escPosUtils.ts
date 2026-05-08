
/**
 * Utility functions for ESC/POS receipt formatting
 */

/**
 * Creates a dashed line separator for thermal receipts
 */
export function dashedLine(width: number = 32): string {
    return '-'.repeat(width);
}

/**
 * Formats a row with two columns (label and value) with space between them
 */
export function formatRow2(label: string, value: string, width: number = 32): string {
    const gap = width - label.length - value.length;
    if (gap <= 0) return `${label.slice(0, width - value.length - 1)} ${value}`;
    return `${label}${' '.repeat(gap)}${value}`;
}

/**
 * Formats a 3-column row (Qty, Name, Price)
 */
export function formatRow3(qty: string, name: string, price: string, width: number = 32): string {
    // Qty: 3, Name: 20, Price: 9 (default 32 chars)
    const qtyCol = qty.padEnd(4);
    const priceCol = price.padStart(9);
    const nameWidth = width - qtyCol.length - priceCol.length;
    const nameCol = name.slice(0, nameWidth).padEnd(nameWidth);
    return `${qtyCol}${nameCol}${priceCol}`;
}

/**
 * Formats a 4-column row (Qty, Item, Price, SubT)
 */
export function formatRow4(qty: string, item: string, price: string, subt: string, width: number = 32): string[] {
  const w1 = 3; // Qty
  const w3 = 7; // Price
  const w4 = 7; // SubT
  // Calculate remaining width for item name, accounting for 3 spaces between columns
  const w2 = width - w1 - w3 - w4 - 3; // Item Name (remaining space)

  const actual_w1 = Math.max(0, w1);
  const actual_w2 = Math.max(0, w2);
  const actual_w3 = Math.max(0, w3);
  const actual_w4 = Math.max(0, w4);

  const nameStr = item.toString();
  const nameChunks: string[] = [];
  
  if (nameStr.length <= actual_w2) {
    nameChunks.push(nameStr);
  } else {
    // Simple wrapping by character
    for (let i = 0; i < nameStr.length; i += actual_w2) {
      nameChunks.push(nameStr.substring(i, i + actual_w2));
    }
  }

  return nameChunks.map((chunk, i) => {
    const s1 = (i === 0 ? qty : "").toString().padEnd(actual_w1).slice(0, actual_w1);
    const s2 = chunk.padEnd(actual_w2);
    const s3 = (i === 0 ? price : "").toString().padStart(actual_w3).slice(0, actual_w3);
    const s4 = (i === 0 ? subt : "").toString().padStart(actual_w4).slice(0, actual_w4);
    return `${s1} ${s2} ${s3} ${s4}`;
  });
}

/**
 * Centers text for a given width
 */
export function centerText(text: string, width: number = 32): string {
    if (text.length >= width) return text.slice(0, width);
    const leftPadding = Math.floor((width - text.length) / 2);
    return ' '.repeat(leftPadding) + text;
}

/**
 * ESC/POS Commands
 */
export const ESC_POS_COMMANDS = {
    RESET: '\x1B\x40',
};
