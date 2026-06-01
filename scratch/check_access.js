const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkAccess() {
  console.log('Checking recent access logs for Lisalyn...');
  
  const { data: logs, error } = await supabase
    .from('access_logs')
    .select('*, shops(name)')
    .eq('employee_id', '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8')
    .order('login_time', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${logs.length} access logs:`);
  logs.forEach(l => {
    console.log(`- Login: ${l.login_time}, Shop: ${l.shops?.name || l.shop_id}`);
  });
}

checkAccess();
