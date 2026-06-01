const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findSale() {
  const productId = 'a679f9f6-a624-4a72-86fc-2de20233ecce'; // Domestic Scones
  
  console.log('Searching for EXACT sale of Domestic Scones (Qty 2, Price 0.25) today...');
  
  const { data: items, error } = await supabase
    .from('sale_items')
    .select('*, sales!inner(*, transaction_receipts(*))')
    .eq('product_id', productId)
    .eq('quantity', 2)
    .eq('unit_price', 0.25)
    .gte('sales.offline_created_at', '2026-05-29T00:00:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${items.length} matches:`);
  items.forEach(item => {
    const localTime = new Date(item.sales.offline_created_at).toLocaleString();
    const shopId = item.sales.transaction_receipts?.[0]?.shop_id || 'Unknown';
    console.log(`- Time: ${localTime} (${item.sales.offline_created_at}), Shop: ${shopId}, Sale ID: ${item.sale_id}`);
  });
  
  // If no exact match, check for ANY sale with total 0.5 today
  if (items.length === 0) {
      console.log('\nNo exact match for Domestic Scones. Checking for any sale with total 0.5 today...');
      const { data: sales05 } = await supabase
        .from('sales')
        .select('*, sale_items(*), transaction_receipts(*)')
        .eq('total_amount', 0.5)
        .gte('offline_created_at', '2026-05-29T00:00:00Z');
      
      console.log(`Found ${sales05?.length || 0} sales with total 0.5:`);
      sales05?.forEach(s => {
          const localTime = new Date(s.offline_created_at).toLocaleString();
          const shopId = s.transaction_receipts?.[0]?.shop_id || 'Unknown';
          console.log(`- Time: ${localTime}, Shop: ${shopId}, ID: ${s.id}`);
          s.sale_items?.forEach(i => console.log(`  - Product ID: ${i.product_id}, Qty: ${i.quantity}, Price: ${i.unit_price}`));
      });
  }
}

findSale();
