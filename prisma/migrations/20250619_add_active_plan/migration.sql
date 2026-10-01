-- Add active_plan JSON column to users table
ALTER TABLE "users" ADD COLUMN "active_plan" JSONB;
