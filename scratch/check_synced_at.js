const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSyncedAt() {
  console.log('Checking sales synced_at around 14:25 UTC...');
  
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*, sale_items(*, products(*)), transaction_receipts(*)')
    .gte('synced_at', '2026-05-29T14:20:00Z')
    .lte('synced_at', new Date().toISOString());

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${sales.length} sales synced in this window:`);
  sales.forEach(s => {
    console.log(`- ID: ${s.id}, Total: ${s.total_amount}, Synced: ${s.synced_at}, Offline: ${s.offline_created_at}`);
    s.sale_items?.forEach(i => {
        console.log(`  - ${i.products?.name}: Qty ${i.quantity} @ ${i.unit_price}`);
    });
  });
}

checkSyncedAt();
