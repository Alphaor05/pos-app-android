const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkLogMetadata() {
  console.log('Checking metadata for Lisalyn\'s 16:25 log...');
  
  const { data: logs, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('employee_id', '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8')
    .eq('amount', 0.5)
    .gte('created_at', '2026-05-29T14:25:00Z')
    .lte('created_at', '2026-05-29T14:26:00Z');

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (logs.length > 0) {
      console.log('Log found:', logs[0]);
      console.log('Metadata content:', logs[0].metadata);
  } else {
      console.log('Log not found with those exact parameters.');
  }
}

checkLogMetadata();
