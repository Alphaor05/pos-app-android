export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ReceiptSettings {
  header?: string;
  footer?: string;
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
      item => {
        // Truncate name like in the user's design (e.g. "Coca ...")
        const truncatedName = item.name.length > 10 
          ? item.name.slice(0, 7).trim() + ' ...' 
          : item.name;

        return `
        <tr>
          <td style="padding:6px 0; font-size:12px; color:#000; text-align:left;">${item.quantity}</td>
          <td style="padding:6px 0; font-size:12px; color:#000; text-align:left;">${truncatedName}</td>
          <td style="padding:6px 0; font-size:12px; color:#000; text-align:right;">$${item.price.toFixed(2)}</td>
          <td style="padding:6px 0; font-size:12px; color:#000; text-align:right;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>`;
      }
    )
    .join('');

  const date = new Date(receipt.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Default to 58mm if not specified (approx 200px equivalent, but web browsers usually scale. We'll set max-width for printed ticket look)
  const isWide = receipt.settings?.receiptSize?.includes('80mm');
  const maxWidth = isWide ? '300px' : '200px';
  const headerHtml = receipt.settings?.header?.replace(/\\n|\n/g, '<br/>') || 'Shaloam Distributors<br/>123 Main Street<br/>Masvingo, Zimbabwe<br/>Tel: +1 234 567 890';
  const footerHtml = receipt.settings?.footer?.replace(/\\n|\n/g, '<br/>') || 'Thank you for shopping<br/>with us!<br/>Please come again.';

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
      padding: 20px 12px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 16px;
      font-size: 14px;
      line-height: 1.4;
    }
    .store-name {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .order-meta {
      text-align: center;
      font-size: 12px;
      margin-bottom: 16px;
      padding: 10px 0;
      border-top: 1px dashed #999;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    thead th {
      font-size: 12px;
      font-weight: bold;
      padding-bottom: 6px;
      border-bottom: 1px solid #000;
      text-align: left;
    }
    thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
    .divider {
      border: none;
      border-top: 1px dashed #999;
      margin: 8px 0 16px 0;
    }
    .totals {
      font-size: 14px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    .total-row.grand {
      font-size: 18px;
      font-weight: bold;
      padding-top: 12px;
      margin-top: 4px;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px dashed #999;
    }
    .footer-text {
      font-size: 12px;
      line-height: 1.5;
      color: #333;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="store-name">${headerHtml}</div>
    </div>

    <div class="order-meta">
      <div>${dateStr}, ${timeStr}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Qty</th>
          <th>Item</th>
          <th>Price</th>
          <th>SubT</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <hr class="divider"/>

    <div class="totals">
      ${receipt.subtotal !== receipt.total ? `
      <div class="total-row">
        <span>Subtotal</span>
        <span>$${receipt.subtotal.toFixed(2)}</span>
      </div>` : ''}
      ${receipt.discount > 0 ? `
      <div class="total-row">
        <span>Discount</span>
        <span>-$${receipt.discount.toFixed(2)}</span>
      </div>` : ''}
      <div class="total-row grand">
        <span>TOTAL</span>
        <span>$${receipt.total.toFixed(2)}</span>
      </div>
    </div>

    <hr class="divider" style="margin-top: 20px;"/>

    <div class="footer">
      <div class="footer-text">${footerHtml}</div>
    </div>
  </div>
</body>
</html>`;
}
