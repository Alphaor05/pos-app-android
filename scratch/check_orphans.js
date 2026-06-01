const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function findOrphans() {
  console.log('Checking for transaction_receipts with NO sale_id today...');
  
  const { data: receipts, error } = await supabase
    .from('transaction_receipts')
    .select('*')
    .is('sale_id', null)
    .gte('created_at', '2026-05-29T00:00:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${receipts.length} orphaned receipts.`);
  receipts.forEach(r => console.log(`- ID: ${r.receipt_id}, Time: ${r.created_at}, Amount: ${r.amount}`));
}

findOrphans();
