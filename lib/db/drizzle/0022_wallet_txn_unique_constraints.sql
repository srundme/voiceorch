CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_razorpay_order_id_unique" ON "wallet_transactions"("razorpay_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_razorpay_payment_id_unique" ON "wallet_transactions"("razorpay_payment_id");
