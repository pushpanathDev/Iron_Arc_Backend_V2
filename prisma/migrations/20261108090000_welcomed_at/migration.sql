-- AlterTable
ALTER TABLE "users" ADD COLUMN     "welcomed_at" TIMESTAMP(3);

-- Accounts that exist today are already set up: they are not sent a welcome email.
UPDATE "users" SET "welcomed_at" = CURRENT_TIMESTAMP;
