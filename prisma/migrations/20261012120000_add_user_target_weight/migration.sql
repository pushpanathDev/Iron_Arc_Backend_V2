-- AddColumn: optional target body weight (kg) set by the user; null = no goal.
ALTER TABLE "users" ADD COLUMN "target_weight" DOUBLE PRECISION;
