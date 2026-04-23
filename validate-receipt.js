/**
 * validate-receipt.js
 * Run with: node validate-receipt.js
 * Simulates the receiptBuilder logic (no RN imports) to verify ESC/POS output.
 */

// ─── Stubs ────────────────────────────────────────────────────────────────────
const DEFAULT_DESIGN = {
  header: 'CRUNCHNUM POS\nThank you for shopping with us!',
  footer: 'All sales are final.\nKeep this receipt for your records.',
  receipt_size: '58mm',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtPrice(val) {
  return `$${Number(val).toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return new Date().toLocaleString();
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso.slice(0, 16).replace('T', ' '); }
}

// ─── Builder ──────────────────────────────────────────────────────────────────
function buildReceiptSync(payload, design = DEFAULT_DESIGN) {
  const lineWidth = design.receipt_size === '80mm' ? 48 : 32;
  const divider   = '-'.repeat(lineWidth);
  const lines     = [];

  // HEADER
  if (design.header) {
    design.header.split('\n').forEach(l => lines.push(`[C]<b>${l.trim()}</b>`));
  }
  lines.push(`[C]${fmtDate(payload.createdAt)}`);
  lines.push(`[C]${divider}`);

  // SALE INFO
  lines.push(`[L]Invoice: [R]#${payload.orderId.slice(-8).toUpperCase()}`);
  if (payload.employeeName) lines.push(`[L]Cashier: [R]${payload.employeeName}`);
  lines.push(`[C]${divider}`);

  // ITEMS HEADER
  lines.push(`[L]<b>Item</b>[R]<b>Amt</b>`);
  lines.push(`[C]${divider}`);

  // ITEMS
  let totalQty = 0;
  for (const item of payload.items) {
    totalQty += item.quantity;
    const lineTotal = item.quantity * item.price;
    lines.push(`[L]${item.name.slice(0, lineWidth - 1)}`);
    lines.push(`[L]  ${item.quantity} x ${fmtPrice(item.price)}[R]${fmtPrice(lineTotal)}`);
  }
  lines.push(`[C]${divider}`);

  // TOTALS
  lines.push(`[L]Items:[R]${totalQty}`);
  if (payload.discount && payload.discount > 0) {
    lines.push(`[L]Subtotal:[R]${fmtPrice(payload.subtotal)}`);
    lines.push(`[L]Discount:[R]-${fmtPrice(payload.discount)}`);
  }
  lines.push(`[L]<b><font size='big'>TOTAL:</font></b>[R]<b><font size='big'>${fmtPrice(payload.total)}</font></b>`);
  if (payload.paymentMethod) lines.push(`[L]Payment:[R]${payload.paymentMethod}`);
  lines.push(`[C]${divider}`);

  // FOOTER
  if (design.footer) {
    design.footer.split('\n').forEach(l => lines.push(`[C]${l.trim()}`));
  }
  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

// ─── Tests ────────────────────────────────────────────────────────────────────
const testCases = [
  {
    label: 'Normal sale — 3 items, discount',
    payload: {
      orderId: '1745678901abc123',
      items: [
        { name: 'Bread White',   quantity: 2,  price: 1.20 },
        { name: 'Butter 250g',   quantity: 1,  price: 6.00 },
        { name: 'Coca Cola 330ml', quantity: 3, price: 2.50 },
      ],
      subtotal: 15.90,
      discount: 1.00,
      total:    14.90,
      paymentMethod: 'USD Cash',
      employeeName:  'John Doe',
      createdAt: new Date().toISOString(),
    },
  },
  {
    label: 'Test print — zero value',
    payload: {
      orderId: 'TEST-ABCDE',
      items: [{ name: 'Test Connection', quantity: 1, price: 0.00 }],
      subtotal: 0,
      discount: 0,
      total:    0,
      paymentMethod: 'Diagnostics',
      employeeName:  'System',
      createdAt: new Date().toISOString(),
    },
  },
  {
    label: 'Long item name (truncation test)',
    payload: {
      orderId: 'LONG123',
      items: [
        { name: 'This is a very very long product name that should be truncated cleanly', quantity: 1, price: 9.99 },
      ],
      subtotal: 9.99,
      discount: 0,
      total:    9.99,
      paymentMethod: 'Card',
      createdAt: new Date().toISOString(),
    },
  },
  {
    label: '80mm receipt',
    payload: {
      orderId: 'WIDE001',
      items: [{ name: 'Wide format item', quantity: 2, price: 5.00 }],
      subtotal: 10,
      discount: 0,
      total: 10,
      paymentMethod: 'Mobile Pay',
      createdAt: new Date().toISOString(),
    },
    design: { ...DEFAULT_DESIGN, receipt_size: '80mm' },
  },
];

let allPassed = true;

for (const tc of testCases) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`TEST: ${tc.label}`);
  console.log('='.repeat(50));

  try {
    const output = buildReceiptSync(tc.payload, tc.design);

    // Assertions
    const checks = [
      { name: '[C] center tags present',    pass: output.includes('[C]') },
      { name: '[L] left tags present',      pass: output.includes('[L]') },
      { name: 'Bold tags present',          pass: output.includes('<b>') },
      { name: 'TOTAL label present',        pass: output.includes('TOTAL:') },
      { name: 'Invoice/orderId present',    pass: output.includes(tc.payload.orderId.slice(-8).toUpperCase()) },
      { name: 'No undefined in output',     pass: !output.includes('undefined') },
      { name: 'No NaN in output',           pass: !output.includes('NaN') },
      { name: 'Trailing newlines present',  pass: output.endsWith('\n\n\n') },
    ];

    for (const c of checks) {
      const icon = c.pass ? '✓' : '✗';
      console.log(`  ${icon} ${c.name}`);
      if (!c.pass) allPassed = false;
    }

    // Print the actual receipt to console for visual inspection
    console.log('\n--- Receipt Output ---');
    console.log(output);
    console.log('--- End Receipt ---');

  } catch (err) {
    console.error(`  ✗ THREW ERROR: ${err.message}`);
    allPassed = false;
  }
}

console.log('\n' + '='.repeat(50));
console.log(allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
console.log('='.repeat(50));
process.exit(allPassed ? 0 : 1);
