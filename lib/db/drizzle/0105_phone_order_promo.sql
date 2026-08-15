-- Record the promo code applied to a phone-number purchase (e.g. VOICEATHON26)
-- and how much it took off the standard pre-GST base, so discounted orders can
-- be reconciled against Razorpay and reported on.
ALTER TABLE "phone_number_orders" ADD COLUMN IF NOT EXISTS "promo_code" text;
ALTER TABLE "phone_number_orders" ADD COLUMN IF NOT EXISTS "discount_paise" integer DEFAULT 0 NOT NULL;
