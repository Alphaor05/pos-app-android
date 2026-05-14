-- SQL to update the handle_pos_sale RPC to support custom timestamps
-- Run this in your Supabase SQL Editor

CREATE OR REPLACE FUNCTION handle_pos_sale(
  p_shop_id TEXT,
  p_items JSONB,
  p_order_id TEXT,
  p_total_amount NUMERIC,
  p_payment_method TEXT,
  p_employee_id TEXT DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW() -- Accept an optional timestamp
) RETURNS void AS $$
BEGIN
  -- 1. Insert into transaction_receipts using the provided timestamp
  -- If p_created_at is provided, it will use that, otherwise defaults to NOW()
  INSERT INTO transaction_receipts (
    order_id, 
    shop_id, 
    items, 
    total, 
    payment_method, 
    employee_id, 
    customer_name, 
    created_at
  ) VALUES (
    p_order_id, 
    p_shop_id, 
    p_items, 
    p_total_amount, 
    p_payment_method, 
    p_employee_id, 
    p_customer_name, 
    p_created_at
  );

  -- 2. Deduct stock (calls existing RPC)
  PERFORM deduct_stock(p_shop_id, p_items);
END;
$$ LANGUAGE plpgsql;
