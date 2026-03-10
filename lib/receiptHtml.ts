export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptSettings {
  businessName?: string;
  address?: string;
  contactTel?: string;
  footerMessage?: string;
  receiptSize?: string;
}

export interface ReceiptData {
  orderId: string;
  orderType?: string; // retail-only; default handled below
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  settings?: ReceiptSettings;
}

export function generateReceiptHtml(receipt: ReceiptData): string {
  const itemRows = receipt.items
    .map(
      item => `
      <tr>
        <td style="padding:4px 0; font-size:12px; color:#222;">${item.name}</td>
        <td style="padding:4px 0; font-size:12px; color:#444; text-align:center;">${item.quantity}</td>
        <td style="padding:4px 0; font-size:12px; color:#222; text-align:right;">$${(item.price * item.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const date = new Date(receipt.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Default to 58mm if not specified (approx 200px equivalent, but web browsers usually scale. We'll set max-width for printed ticket look)
  const isWide = receipt.settings?.receiptSize?.includes('80mm');
  const maxWidth = isWide ? '300px' : '200px';
  const businessName = receipt.settings?.businessName || 'MY BUSINESS';
  const address = receipt.settings?.address?.replace(/\\n|\n/g, '<br/>') || '123 Main Street<br/>City, Country';
  const tel = receipt.settings?.contactTel || '+1 234 567 890';
  const footerMessage = receipt.settings?.footerMessage?.replace(/\\n|\n/g, '<br/>') || 'Thank you for shopping with us!<br/>Please come again.';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #fff;
      color: #000;
      display: flex;
      justify-content: center;
      padding: 0;
    }
    .receipt {
      width: 100%;
      max-width: ${maxWidth};
      background: #fff;
      padding: 16px 10px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 12px;
    }
    .store-name {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .store-sub {
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 2px;
    }
    .order-meta {
      text-align: center;
      font-size: 11px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px dashed #000;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    thead th {
      font-size: 11px;
      text-transform: uppercase;
      padding-bottom: 4px;
      border-bottom: 1px dashed #000;
      text-align: left;
    }
    thead th:nth-child(2) { text-align: center; }
    thead th:nth-child(3) { text-align: right; }
    .divider {
      border: none;
      border-top: 1px dashed #000;
      margin: 4px 0 12px 0;
    }
    .totals {
      font-size: 13px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .total-row.grand {
      font-size: 15px;
      font-weight: bold;
      padding-top: 6px;
      border-top: 1px solid #000;
      margin-top: 2px;
    }
    .footer {
      text-align: center;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px dashed #000;
    }
    .footer-text {
      font-size: 11px;
      line-height: 1.4;
    }
    .barcode {
      margin-top: 10px;
      font-size: 8px;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="store-name">${businessName}</div>
      <div class="store-sub">${address}</div>
      <div class="store-sub">Tel: ${tel}</div>
    </div>

    <div class="order-meta">
      <div>${dateStr}, ${timeStr}</div>
      <div style="margin-top:4px;">${(receipt.orderType ?? 'RETAIL').toUpperCase()} - #${receipt.orderId.slice(0, 8).toUpperCase()}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>SubT</th>
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
      ${receipt.tax > 0 ? `
      <div class="total-row">
        <span>Tax</span>
        <span>$${receipt.tax.toFixed(2)}</span>
      </div>` : ''}
      <div class="total-row grand">
        <span>TOTAL</span>
        <span>$${receipt.total.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer">
      <div class="footer-text">${footerMessage}</div>
      <div class="barcode">|| | || | || || | | | ||| | ||</div>
    </div>
  </div>
</body>
</html>`;
}
