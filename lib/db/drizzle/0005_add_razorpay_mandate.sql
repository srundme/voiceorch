ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "razorpay_customer_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "razorpay_token_id" text;
