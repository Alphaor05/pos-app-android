const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSale() {
  const mtCbdId = '046f42b7-a10f-4fb2-8af2-7f4bf2beb889';
  const startTime = '2026-05-29T14:20:00Z'; // 16:20 local
  const endTime = '2026-05-29T14:30:00Z';   // 16:30 local

  console.log(`Checking sales for MT CBD (ID: ${mtCbdId}) between 16:20 and 16:30 local...`);

  // We need to fetch from transaction_receipts first to link to the shop if sales doesn't have shop_id directly
  // Actually, let's check sales columns again. It has shift_id, employee_id.
  // Let's check transaction_receipts which HAS shop_id and sale_id.

  const { data: receipts, error: receiptsError } = await supabase
    .from('transaction_receipts')
    .select('*, sales(*, sale_items(*, products(*)))')
    .eq('shop_id', mtCbdId)
    .gte('created_at', startTime)
    .lte('created_at', endTime);

  if (receiptsError) {
    console.error('Error fetching receipts:', receiptsError);
    return;
  }

  if (receipts.length === 0) {
    console.log('No receipts found for MT CBD in that time range.');
    // Check all receipts around that time regardless of shop just in case
    const { data: allReceipts } = await supabase
        .from('transaction_receipts')
        .select('*, sales(*, sale_items(*, products(*)))')
        .gte('created_at', startTime)
        .lte('created_at', endTime);
    
    console.log(`Found ${allReceipts?.length || 0} receipts total in range across all shops.`);
    allReceipts?.forEach(r => {
        console.log(`Receipt ID: ${r.receipt_id}, Shop: ${r.shop_id}, Total: ${r.amount}, Time: ${r.created_at}`);
        r.sales?.sale_items?.forEach(i => {
           console.log(`  - ${i.products?.name || 'Unknown Product'}: Qty ${i.quantity} @ ${i.unit_price}`);
        });
    });
  } else {
    console.log(`Found ${receipts.length} receipts for MT CBD:`);
    receipts.forEach(r => {
        console.log(`Receipt ID: ${r.receipt_id}, Time: ${r.created_at}, Total: ${r.amount}`);
        r.sales?.sale_items?.forEach(i => {
           console.log(`  - ${i.products?.name || 'Unknown Product'}: Qty ${i.quantity} @ ${i.unit_price}`);
        });
    });
  }
}

checkSale();
