-- AddColumns: training profile asked once at onboarding. All nullable or empty by default,
-- so existing rows and older app versions keep working.
ALTER TABLE "users" ADD COLUMN "experience_level" TEXT;
ALTER TABLE "users" ADD COLUMN "equipment" TEXT;
ALTER TABLE "users" ADD COLUMN "session_minutes" INTEGER;
ALTER TABLE "users" ADD COLUMN "training_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "users" ADD COLUMN "avoid_areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
