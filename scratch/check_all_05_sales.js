const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkAll05Sales() {
  console.log('Searching for ALL sales of $0.50 across all shops today...');
  
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*, transaction_receipts(shop_id, shops(name))')
    .eq('total_amount', 0.5)
    .gte('offline_created_at', '2026-05-29T00:00:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${sales.length} sales of $0.50 today:`);
  sales.forEach(s => {
      const shopName = s.transaction_receipts?.[0]?.shops?.name || 'Unknown';
      console.log(`- Sale ID: ${s.id}, Time: ${s.offline_created_at}, Shop: ${shopName}, Employee: ${s.employee_id}`);
  });
}

checkAll05Sales();
