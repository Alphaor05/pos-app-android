
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
 * Centers text for a given width
 */
export function centerText(text: string, width: number = 32): string {
    if (text.length >= width) return text.slice(0, width);
    const leftPadding = Math.floor((width - text.length) / 2);
    return ' '.repeat(leftPadding) + text;
}
