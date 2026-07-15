-- One-time migrate wallet/ledger/phone amounts from USD cents → INR paise.
-- Multiplier 85 ≈ historical usd_to_inr_rate used for UPI mandates.
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
    wallet_balance_cents = wallet_balance_cents * 85,
    auto_pay_threshold_cents = GREATEST(auto_pay_threshold_cents * 85, 10000),
    auto_pay_amount_cents = GREATEST(auto_pay_amount_cents * 85, 50000);

  UPDATE wallet_transactions
  SET amount_cents = amount_cents * 85;

  UPDATE phone_numbers
  SET
    monthly_rate_cents = 80000,
    renewal_rate_cents = 94400
  WHERE status = 'active';

  UPDATE phone_number_orders
  SET amount_cents = amount_cents * 85
  WHERE amount_cents IS NOT NULL
    AND amount_cents > 0
    AND amount_cents < 10000; -- only rewrite legacy USD-cent sized amounts

  INSERT INTO platform_settings (key, value)
  VALUES ('billing_currency', 'INR')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RAISE NOTICE 'Migrated wallet/ledger amounts ×85 and set billing_currency=INR';
END $$;
