-- Never written: the coach chat lives in plan_data._chatHistory.
ALTER TABLE "plans" DROP COLUMN "chat_history";

-- Always equal to created_at.
ALTER TABLE "plans" DROP COLUMN "generated_at";
