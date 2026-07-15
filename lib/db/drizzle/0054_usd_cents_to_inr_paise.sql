-- One-time migrate wallet/ledger/phone amounts from USD cents → INR paise.
-- Multiplier 96.36 = USD→INR rate (2026-07-15).
-- After this, *cents columns are interpreted as paise (1 INR = 100 paise).
--
-- Idempotency: set platform_settings key billing_currency=INR after apply.
-- Skip if already migrated.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform_settings WHERE key = 'billing_currency' AND value = 'INR'
  ) THEN
    RAISE NOTICE 'billing_currency already INR — skipping USD→INR paise migration';
    RETURN;
  END IF;

  UPDATE users
  SET
    wallet_balance_cents = ROUND(wallet_balance_cents * 96.36)::integer,
    auto_pay_threshold_cents = GREATEST(ROUND(auto_pay_threshold_cents * 96.36)::integer, 10000),
    auto_pay_amount_cents = GREATEST(ROUND(auto_pay_amount_cents * 96.36)::integer, 50000);

  UPDATE wallet_transactions
  SET amount_cents = ROUND(amount_cents * 96.36)::integer;

  UPDATE phone_numbers
  SET
    monthly_rate_cents = 80000,
    renewal_rate_cents = 94400
  WHERE status = 'active';

  UPDATE phone_number_orders
  SET amount_cents = ROUND(amount_cents * 96.36)::integer
  WHERE amount_cents IS NOT NULL
    AND amount_cents > 0
    AND amount_cents < 10000; -- only rewrite legacy USD-cent sized amounts

  INSERT INTO platform_settings (key, value)
  VALUES ('billing_currency', 'INR')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO platform_settings (key, value)
  VALUES ('usd_to_inr_rate', '96.36')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RAISE NOTICE 'Migrated wallet/ledger amounts ×96.36 and set billing_currency=INR';
END $$;
