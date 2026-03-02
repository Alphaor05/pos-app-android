export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptData {
  orderId: string;
  orderType: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
}

export function generateReceiptHtml(receipt: ReceiptData): string {
  const itemRows = receipt.items
    .map(
      item => `
      <tr>
        <td style="padding:4px 0; font-size:13px; color:#e2e8f0;">${item.name}</td>
        <td style="padding:4px 0; font-size:13px; color:#94a3b8; text-align:center;">${item.quantity}</td>
        <td style="padding:4px 0; font-size:13px; color:#e2e8f0; text-align:right;">$${(item.price * item.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const date = new Date(receipt.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      background: #0d1117;
      color: #e2e8f0;
      display: flex;
      justify-content: center;
      padding: 20px;
    }
    .receipt {
      width: 320px;
      background: #161b22;
      border-radius: 12px;
      padding: 24px 20px;
      border: 1px solid #30363d;
    }
    .header {
      text-align: center;
      border-bottom: 1px dashed #30363d;
      padding-bottom: 16px;
      margin-bottom: 16px;
    }
    .store-name {
      font-size: 20px;
      font-weight: bold;
      color: #f0f6fc;
      letter-spacing: 2px;
      margin-bottom: 4px;
    }
    .store-sub {
      font-size: 11px;
      color: #8b949e;
      letter-spacing: 1px;
    }
    .order-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;
      font-size: 11px;
      color: #8b949e;
    }
    .order-type-badge {
      background: #2563eb22;
      color: #3b82f6;
      border: 1px solid #2563eb;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 1px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    thead th {
      font-size: 10px;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding-bottom: 8px;
      border-bottom: 1px solid #30363d;
    }
    thead th:nth-child(2) { text-align: center; }
    thead th:nth-child(3) { text-align: right; }
    .divider {
      border: none;
      border-top: 1px dashed #30363d;
      margin: 12px 0;
    }
    .totals {
      font-size: 12px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      color: #8b949e;
    }
    .total-row.grand {
      color: #f0f6fc;
      font-size: 16px;
      font-weight: bold;
      padding-top: 8px;
      border-top: 1px solid #30363d;
      margin-top: 4px;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px dashed #30363d;
    }
    .footer-text {
      font-size: 11px;
      color: #8b949e;
      letter-spacing: 1px;
    }
    .order-id {
      font-size: 10px;
      color: #484f58;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="store-name">POS TERMINAL</div>
      <div class="store-sub">FISCAL RECEIPT</div>
    </div>

    <div class="order-meta">
      <div>
        <div>${dateStr}</div>
        <div>${timeStr}</div>
      </div>
      <div class="order-type-badge">${receipt.orderType.toUpperCase()}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th>Qty</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider"/>

    <div class="totals">
      <div class="total-row">
        <span>Subtotal</span>
        <span>$${receipt.subtotal.toFixed(2)}</span>
      </div>
      ${receipt.discount > 0 ? `
      <div class="total-row">
        <span>Discount</span>
        <span>-$${receipt.discount.toFixed(2)}</span>
      </div>` : ''}
      <div class="total-row">
        <span>Tax (5%)</span>
        <span>$${receipt.tax.toFixed(2)}</span>
      </div>
      <div class="total-row grand">
        <span>TOTAL</span>
        <span>$${receipt.total.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer">
      <div class="footer-text">THANK YOU FOR YOUR PURCHASE</div>
      <div class="order-id">Order #${receipt.orderId.slice(0, 8).toUpperCase()}</div>
    </div>
  </div>
</body>
</html>`;
}
