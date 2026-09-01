-- SQL to update the handle_pos_sale RPC to support custom timestamps
-- Run this in your Supabase SQL Editor.
--
-- IMPORTANT: This is a VERBATIM copy of the currently-deployed RPC, taken from:
--   SELECT pg_get_functiondef('handle_pos_sale'::regproc);
-- It matches the live function exactly (including SECURITY DEFINER and the
-- payment_type_enum mapping). Do NOT "fix" or "simplify" it — e.g. do NOT
-- re-introduce order_id/items/total/payment_method columns on
-- transaction_receipts; those do not exist in the current schema.
--
-- The app's id (p_order_id) is stored as transaction_receipts.receipt_id.
-- The unique index on transaction_receipts(receipt_id) makes retries idempotent:
-- a re-insert raises 23505, the whole transaction rolls back BEFORE deduct_stock
-- runs, so stock is never double-deducted.
--
-- Note: the strict ::uuid casts on shop_id / product_id are intentional — they
-- are what surface invalid test data (e.g. 'mpy2', 'PROD-001') as sync failures
-- that get surfaced to the cashier/queue instead of silently writing bad rows.

CREATE OR REPLACE FUNCTION public.handle_pos_sale(p_shop_id text, p_items jsonb, p_order_id text, p_total_amount numeric, p_payment_method text, p_employee_id text, p_customer_name text, p_created_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale_id        UUID;
  v_payment_type   payment_type_enum;
  v_item           JSONB;
BEGIN
  -- 1. Map payment types
  v_payment_type := CASE p_payment_method
    WHEN 'USD Cash'    THEN 'Cash'
    WHEN 'Cash'        THEN 'Cash'
    WHEN 'EcoCash'     THEN 'EcoCash'
    WHEN 'Ecocash USD' THEN 'EcoCash'
    WHEN 'Swipe'       THEN 'Swipe'
    ELSE 'Other'
  END::payment_type_enum;

  -- 2. Insert into sales (Strict Employee ID)
  INSERT INTO sales (total_amount, payment_method, offline_created_at, synced_at, employee_id)
  VALUES (
    p_total_amount,
    p_payment_method,
    COALESCE(p_created_at, NOW()),
    NOW(),
    CASE WHEN p_employee_id IS NOT NULL AND p_employee_id <> '' THEN p_employee_id::uuid ELSE NULL END
  )
  RETURNING id INTO v_sale_id;

  -- 3. Insert into transaction_receipts (Strict Shop ID - will fail if mpy2)
  INSERT INTO transaction_receipts (receipt_id, shop_id, amount, payment_type, created_at, date_time, sale_id)
  VALUES (
    p_order_id,
    p_shop_id::uuid, -- This cast triggers the 'Strict' failure we want
    p_total_amount,
    v_payment_type,
    NOW(),
    COALESCE(p_created_at, NOW()),
    v_sale_id
  );

  -- 4. Insert individual line items (Strict Product ID - will fail if PROD-001)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price)
    VALUES (
      gen_random_uuid(),
      v_sale_id,
      (v_item->>'product_id')::UUID, -- This cast triggers the notification on the tablet
      (v_item->>'quantity')::INTEGER,
      (v_item->>'price')::NUMERIC
    );
  END LOOP;

  -- 5. Deduct stock
  PERFORM deduct_stock(p_shop_id, p_items);

END;
$function$
;
