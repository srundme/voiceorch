ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id");
