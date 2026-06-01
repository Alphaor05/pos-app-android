const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findReceipt() {
  console.log('Searching for transaction receipts with amount 0.5 today...');
  
  const { data: receipts, error } = await supabase
    .from('transaction_receipts')
    .select('*')
    .eq('amount', 0.5)
    .gte('created_at', '2026-05-29T00:00:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${receipts.length} receipts with amount 0.5:`);
  receipts.forEach(r => {
    console.log(`- Receipt ID: ${r.receipt_id}, Time: ${r.created_at}, Shop: ${r.shop_id}, Sale ID: ${r.sale_id}`);
  });
}

findReceipt();
