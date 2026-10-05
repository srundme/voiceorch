DO $$
BEGIN
  BEGIN
    ALTER TABLE "partners" ADD COLUMN "concurrent_limit" integer DEFAULT 10 NOT NULL;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;

  BEGIN
    ALTER TABLE "partner_pending_promotions" ADD COLUMN "concurrent_limit" integer DEFAULT 10 NOT NULL;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;
END $$;
