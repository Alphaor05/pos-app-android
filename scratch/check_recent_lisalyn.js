const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkRecentLogs() {
  console.log('Checking for ANY logs from Lisalyn in the last 5 minutes...');
  
  const fiveMinsAgo = new Date(Date.now() - 300000).toISOString();
  
  const { data: logs, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('employee_id', '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8')
    .gte('created_at', fiveMinsAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${logs.length} recently synced logs from Lisalyn.`);
  logs.forEach(l => {
    console.log(`- Action: ${l.action_type}, Time: ${l.created_at}, Amount: ${l.amount}`);
  });
}

checkRecentLogs();
