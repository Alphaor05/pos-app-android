-- SQL to fix existing wrong cashier entries and dates
-- This version targets the 'sales' table where employee_id is actually stored.
-- Run this in your Supabase SQL Editor

BEGIN;

DO $$
DECLARE
  lisalyn_id UUID;
  mai_tino_id UUID;
  mt_cbd_id UUID;
  updated_sales_count INTEGER;
  updated_receipts_count INTEGER;
BEGIN
  -- 1. Find the correct IDs based on names
  SELECT employee_id INTO lisalyn_id FROM employees WHERE first_name ILIKE 'Lisalyn%' LIMIT 1;
  SELECT employee_id INTO mai_tino_id FROM employees WHERE first_name ILIKE 'Mai%' AND last_name ILIKE 'Tino%' LIMIT 1;
  SELECT id INTO mt_cbd_id FROM shops WHERE name ILIKE '%MT CBD%' LIMIT 1;

  IF lisalyn_id IS NULL OR mt_cbd_id IS NULL THEN
    RAISE EXCEPTION 'Could not find Lisalyn or MT CBD shop in the database. Please check names.';
  END IF;

  -- 2. Update the 'sales' table
  -- We link it to 'transaction_receipts' to filter by shop_id
  UPDATE sales
  SET 
    employee_id = lisalyn_id,
    offline_created_at = COALESCE(offline_created_at, synced_at) - INTERVAL '1 day'
  FROM transaction_receipts tr
  WHERE sales.id = tr.sale_id
    AND tr.shop_id::text = mt_cbd_id::text
    AND (sales.employee_id::text = mai_tino_id::text OR sales.employee_id IS NULL)
    AND sales.synced_at::date = CURRENT_DATE;

  GET DIAGNOSTICS updated_sales_count = ROW_COUNT;
  RAISE NOTICE 'Updated % sales records', updated_sales_count;

  -- 3. Update the 'transaction_receipts' table timestamps
  UPDATE transaction_receipts
  SET 
    created_at = created_at - INTERVAL '1 day',
    date_time = date_time - INTERVAL '1 day'
  WHERE 
    shop_id::text = mt_cbd_id::text
    AND sale_id IN (
      -- Only update receipts for the sales we just identified as wrong
      SELECT id FROM sales 
      WHERE employee_id = lisalyn_id -- They are now assigned to Lisalyn
      AND synced_at::date = CURRENT_DATE
    );

  GET DIAGNOSTICS updated_receipts_count = ROW_COUNT;
  RAISE NOTICE 'Updated % receipt records', updated_receipts_count;

  -- 4. Update activity_logs
  UPDATE activity_logs
  SET 
    employee_id = lisalyn_id,
    created_at = created_at - INTERVAL '1 day'
  WHERE 
    employee_id::text = mai_tino_id::text
    AND created_at::date = CURRENT_DATE;

END $$;

COMMIT;
