const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkLogs() {
  console.log('Checking for sync failures or activity logs around 16:25...');
  
  const { data: logs, error } = await supabase
    .from('activity_logs')
    .select('*')
    .gte('created_at', '2026-05-29T14:20:00Z')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${logs.length} logs:`);
  logs.forEach(l => {
    console.log(`- Action: ${l.action_type}, Employee: ${l.employee_id}, Time: ${l.created_at}, Amount: ${l.amount}`);
    if (l.metadata) console.log(`  Metadata: ${l.metadata}`);
  });
}

checkLogs();
