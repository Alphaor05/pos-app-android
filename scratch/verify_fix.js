const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function verifyFix() {
  console.log('Verifying implementation...');

  // 1. Check if we can find any RECENT logs with metadata
  console.log('Searching for activity logs with metadata created in the last 1 minute...');
  
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
  
  const { data: logs, error } = await supabase
    .from('activity_logs')
    .select('*')
    .gte('created_at', oneMinuteAgo);

  if (error) {
    console.error('Error fetching logs:', error);
    return;
  }

  if (logs.length === 0) {
    console.log('No logs found in the last minute. This is expected if nobody is using the app right now.');
  } else {
    console.log(`Found ${logs.length} logs.`);
    logs.forEach(l => {
        console.log(`- Type: ${l.action_type}, Time: ${l.created_at}, Metadata: ${l.metadata}`);
    });
  }

  console.log('\nVerification script complete. Since I cannot run the React Native app, I rely on code inspection and schema verification.');
}

verifyFix();
