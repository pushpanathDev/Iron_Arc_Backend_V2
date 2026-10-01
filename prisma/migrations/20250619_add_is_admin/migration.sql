-- Add is_admin column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" BOOLEAN NOT NULL DEFAULT false;
