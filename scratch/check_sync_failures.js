const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSyncFailures() {
  console.log('Checking for sync_failure logs today...');
  
  const { data: logs, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('action_type', 'sync_failure')
    .gte('created_at', '2026-05-29T00:00:00Z')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${logs.length} sync failure logs:`);
  logs.forEach(l => {
    console.log(`- Time: ${l.created_at}, Amount: ${l.amount}`);
    if (l.metadata) {
        try {
            const meta = JSON.parse(l.metadata);
            console.log(`  Error: ${meta.error}`);
            console.log(`  Order ID: ${meta.order_id}`);
        } catch(e) {
            console.log(`  Metadata: ${l.metadata}`);
        }
    }
  });
}

checkSyncFailures();
