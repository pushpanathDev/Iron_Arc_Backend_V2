-- Each of these is covered by another index that starts with the same
-- columns, so lookups stay fast; dropping them only saves work on every write.

-- Covered by plans_user_id_is_active_idx (user_id, is_active).
DROP INDEX "plans_user_id_idx";

-- The same columns as the unique key body_weights_user_id_date_key.
DROP INDEX "body_weights_user_id_date_idx";

-- Covered by the unique key achievements_user_id_badge_key_key (user_id, badge_key).
DROP INDEX "achievements_user_id_idx";

-- Covered by the unique key custom_exercises_user_id_category_name_key (user_id, category, name).
DROP INDEX "custom_exercises_user_id_category_idx";
