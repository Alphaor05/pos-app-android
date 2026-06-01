const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkRecentSaleShop() {
  console.log('Checking shop_id for Lisalyn\'s recent synced sales...');
  
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*, transaction_receipts(*)')
    .eq('employee_id', '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8')
    .order('offline_created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  sales.forEach(s => {
      console.log(`- Sale ID: ${s.id}, Offline: ${s.offline_created_at}`);
      s.transaction_receipts?.forEach(r => {
          console.log(`  - Receipt Shop ID: ${r.shop_id}`);
      });
  });
}

checkRecentSaleShop();
