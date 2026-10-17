-- Workouts logged from AI plans under a spelling that isn't in the app's
-- exercise catalogue (before plans used one fixed name per exercise). Renamed
-- to the catalogue name, so past sets show up as "Last: …" again. Exact names
-- only (any letter case); everything else is left alone.
UPDATE "workouts" SET "exercise" = 'Dips (Triceps)' WHERE lower("exercise") = lower('Triceps Dip');
UPDATE "workouts" SET "exercise" = 'Dips (Triceps)' WHERE lower("exercise") = lower('Tricep Dip');
UPDATE "workouts" SET "exercise" = 'Incline Barbell Bench Press' WHERE lower("exercise") = lower('Incline Barbell Press');
UPDATE "workouts" SET "exercise" = 'Tricep Pushdown' WHERE lower("exercise") = lower('Triceps Pushdown');
UPDATE "workouts" SET "exercise" = 'Lateral Raise' WHERE lower("exercise") = lower('Dumbbell Lateral Raise');
UPDATE "workouts" SET "exercise" = 'Pull Ups' WHERE lower("exercise") = lower('Pull Up');
UPDATE "workouts" SET "exercise" = 'Pull Ups' WHERE lower("exercise") = lower('Pull-Up');
UPDATE "workouts" SET "exercise" = 'Push Ups' WHERE lower("exercise") = lower('Push Up');
UPDATE "workouts" SET "exercise" = 'Push Ups' WHERE lower("exercise") = lower('Push-Up');
UPDATE "workouts" SET "exercise" = 'Barbell Overhead Press' WHERE lower("exercise") = lower('Overhead Press');
UPDATE "workouts" SET "exercise" = 'Barbell Curl' WHERE lower("exercise") = lower('Barbell Bicep Curl');
UPDATE "workouts" SET "exercise" = 'Dumbbell Curl' WHERE lower("exercise") = lower('Dumbbell Bicep Curl');
UPDATE "workouts" SET "exercise" = 'Barbell Back Squat' WHERE lower("exercise") = lower('Barbell Squat');
UPDATE "workouts" SET "exercise" = 'Walking Lunges' WHERE lower("exercise") = lower('Dumbbell Lunge');
UPDATE "workouts" SET "exercise" = 'Lying Leg Curl' WHERE lower("exercise") = lower('Leg Curl');
UPDATE "workouts" SET "exercise" = 'Standing Calf Raise' WHERE lower("exercise") = lower('Calf Raise');
UPDATE "workouts" SET "exercise" = 'Crunches' WHERE lower("exercise") = lower('Crunch');
UPDATE "workouts" SET "exercise" = 'Burpees' WHERE lower("exercise") = lower('Burpee');
UPDATE "workouts" SET "exercise" = 'Mountain Climbers' WHERE lower("exercise") = lower('Mountain Climber');
