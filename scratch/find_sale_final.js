const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findSale() {
  console.log('Searching for the sale with total 0.5 at 14:25 UTC...');
  
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*, sale_items(*, products(*)), transaction_receipts(*)')
    .eq('total_amount', 0.5)
    .gte('offline_created_at', '2026-05-29T14:24:00Z')
    .lte('offline_created_at', '2026-05-29T14:27:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (sales.length === 0) {
    console.log('No sale found in sales table with total 0.5 at that time.');
    // Maybe total_amount is stored as a string or differently?
    console.log('Checking all sales around that time regardless of amount...');
     const { data: allSales } = await supabase
        .from('sales')
        .select('*, sale_items(*, products(*)), transaction_receipts(*)')
        .gte('offline_created_at', '2026-05-29T14:24:00Z')
        .lte('offline_created_at', '2026-05-29T14:27:00Z');
     
     console.log(`Found ${allSales?.length || 0} sales around that time.`);
     allSales?.forEach(s => {
         console.log(`Sale ID: ${s.id}, Total: ${s.total_amount}, Time: ${s.offline_created_at}`);
         s.sale_items?.forEach(i => {
             console.log(`  - ${i.products?.name}: Qty ${i.quantity} @ ${i.unit_price}`);
         });
     });
  } else {
    console.log(`Found ${sales.length} matching sales:`);
    sales.forEach(s => {
        console.log(`Sale ID: ${s.id}, Total: ${s.total_amount}, Time: ${s.offline_created_at}`);
        s.sale_items?.forEach(i => {
            console.log(`  - ${i.products?.name}: Qty ${i.quantity} @ ${i.unit_price}`);
        });
    });
  }
}

findSale();
