const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findLisalyn() {
  console.log('Finding employee "Lisalyn"...');
  
  const { data: employees, error } = await supabase
    .from('employees')
    .select('*')
    .ilike('first_name', '%Lisalyn%');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Employees found:', employees);
  
  if (employees.length > 0) {
      const lisalyn = employees[0];
      const employeeId = lisalyn.employee_id;
      console.log(`Searching for sales by Lisalyn (${employeeId}) around 14:25 UTC...`);
      
      const { data: logs } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('created_at', '2026-05-29T14:20:00Z')
        .lte('created_at', '2026-05-29T14:35:00Z');
      
      console.log(`Found ${logs?.length || 0} activity logs for Lisalyn:`);
      logs?.forEach(l => console.log(`- ${l.action_type} at ${l.created_at}, Amount: ${l.amount}`));

      const { data: sales } = await supabase
        .from('sales')
        .select('*, sale_items(*, products(*)), transaction_receipts(*)')
        .eq('employee_id', employeeId)
        .gte('offline_created_at', '2026-05-29T14:20:00Z')
        .lte('offline_created_at', '2026-05-29T14:35:00Z');
      
      console.log(`Found ${sales?.length || 0} sales entries for Lisalyn:`);
      sales?.forEach(s => {
          console.log(`- ID: ${s.id}, Total: ${s.total_amount}, Time: ${s.offline_created_at}`);
          s.sale_items?.forEach(i => console.log(`  - ${i.products?.name}: Qty ${i.quantity} @ ${i.unit_price}`));
      });
  }
}

findLisalyn();
