ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_razorpay_order_id_unique" UNIQUE("razorpay_order_id");
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id");
