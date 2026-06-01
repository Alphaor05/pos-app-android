const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkSchema() {
  console.log('Checking activity_logs schema...');
  
  // We can't directy query schema via JS client easily, but we can try to insert a test log with metadata
  const testId = 'test-' + Date.now();
  const { data, error } = await supabase
    .from('activity_logs')
    .insert({
        employee_id: '2bcb9e63-90e7-4ae3-910a-3636a4ce97f8',
        action_type: 'sale_complete',
        amount: 0.01,
        metadata: JSON.stringify({ order_id: testId })
    })
    .select();

  if (error) {
    console.error('Error inserting test log:', error);
  } else {
    console.log('Successfully inserted test log:', data);
  }
}

checkSchema();
