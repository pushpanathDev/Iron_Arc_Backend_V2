ALTER TABLE "users" DROP COLUMN "active_plan";

CREATE UNIQUE INDEX "plans_one_active_per_user_idx"
ON "plans" ("user_id")
WHERE "is_active" = true;