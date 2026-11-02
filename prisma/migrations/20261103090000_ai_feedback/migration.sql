-- Thumbs up/down on coach replies (AI evaluation, v2.1): one row per reply, with a copy of it.
-- Additive only: a new table.
-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "message_at" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "rating" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_feedback_created_at_idx" ON "ai_feedback"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_feedback_user_id_plan_id_message_at_key" ON "ai_feedback"("user_id", "plan_id", "message_at");

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

