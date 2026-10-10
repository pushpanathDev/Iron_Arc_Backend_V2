-- CreateTable: append-only log of AI plan generations (drives ai_plan_* badges)
CREATE TABLE "plan_generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_generations_user_id_idx" ON "plan_generations"("user_id");

-- AddForeignKey
ALTER TABLE "plan_generations" ADD CONSTRAINT "plan_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one generation per plan that still exists (deleted plans are unrecoverable).
INSERT INTO "plan_generations" ("id", "user_id", "created_at")
SELECT gen_random_uuid()::text, "user_id", "generated_at" FROM "plans";
