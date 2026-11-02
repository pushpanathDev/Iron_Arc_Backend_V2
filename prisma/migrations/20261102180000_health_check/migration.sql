-- The AI coach's health check: yes/no answers and when the user agreed to the AI terms.
-- Additive only: one nullable column, existing rows stay as they are.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "health_check" JSONB;
