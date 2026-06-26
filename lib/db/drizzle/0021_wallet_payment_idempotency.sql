DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_razorpay_payment_id_unique' AND conrelid = 'wallet_transactions'::regclass) THEN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id");
  END IF;
END $$;
