const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findSalesByEmployee() {
  const employeeId = '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8';
  console.log(`Checking all sales for employee ${employeeId} today...`);
  
  const { data: sales, error } = await supabase
    .from('sales')
    .select('*, sale_items(*, products(*)), transaction_receipts(*)')
    .eq('employee_id', employeeId)
    .gte('offline_created_at', '2026-05-29T00:00:00Z')
    .order('offline_created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${sales.length} sales:`);
  sales.forEach(s => {
    console.log(`- ID: ${s.id}, Total: ${s.total_amount}, Time: ${s.offline_created_at}`);
    s.sale_items?.forEach(i => {
        console.log(`  - ${i.products?.name}: Qty ${i.quantity} @ ${i.unit_price}`);
    });
  });
}

findSalesByEmployee();
