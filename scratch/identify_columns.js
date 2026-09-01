const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uxbcdnofumukytzjhrrz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkColumns() {
    console.log('Checking products table...');
    const { data: prodData } = await supabase.from('products').select('*').limit(1);
    if (prodData && prodData.length > 0) {
        console.log('Products columns:', Object.keys(prodData[0]));
    } else {
        console.log('No products found');
    }

    console.log('\nChecking product_shop_stock table...');
    const { data: stockData } = await supabase.from('product_shop_stock').select('*').limit(1);
    if (stockData && stockData.length > 0) {
        console.log('Product_shop_stock columns:', Object.keys(stockData[0]));
    } else {
        console.log('No product_shop_stock found');
    }
}

checkColumns();
