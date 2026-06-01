const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkProduct() {
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .ilike('name', '%Domestic Scones%');

  if (error) {
    console.error('Error fetching products:', error);
    // Try 'inventory' table
    console.log('Trying inventory table...');
    const { data: inventory } = await supabase.from('inventory').select('*').limit(5);
    console.log('Inventory columns:', Object.keys(inventory?.[0] || {}));
    return;
  }

  console.log('Products found:', products);
  const scone = products.find(p => p.name.includes('Domestic Scones'));
  if (scone) {
      console.log(`Domestic Scones ID: ${scone.id || scone.product_id}`);
      
      // Now check sale_items for this product_id today
      const productId = scone.id || scone.product_id;
      const { data: items } = await supabase
        .from('sale_items')
        .select('*, sales!inner(*)')
        .eq('product_id', productId)
        .gte('sales.offline_created_at', '2026-05-29T00:00:00Z');
      
      console.log(`Found ${items?.length || 0} sales for this product today:`);
      items?.forEach(i => {
          console.log(`  - Sale ID: ${i.sale_id}, Qty: ${i.quantity}, Price: ${i.unit_price}, Time: ${i.sales.offline_created_at}`);
      });
  }
}

checkProduct();
