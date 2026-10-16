/**
 * The prompts for every AI plan call: generate, next week, swap and the coach
 * chat. Plain text in, nothing sent here; services/aiClient.js does the call.
 * Exercise lists come from the exercise database, for the user's equipment.
 */
const { WEEKDAYS } = require("./planChat");
const { allowedExerciseIds, equipmentTagsFor } = require("./exerciseDatabase");
const { SPLIT_NAMES, PROGRESSION_RULES } = require("./planSchedule");

const WEEKDAY_NAMES = WEEKDAYS.map((day) => day[0].toUpperCase() + day.slice(1));
/** How a session flows; the validator also sorts by these tiers as a safety net. */
const ORDER_RULE =
  "Order each day like a real session: heavy compound lifts first (squat, deadlift, bench, overhead press, rows, pull-ups), then secondary compounds (dumbbell presses, pulldowns, leg press, lunges), then isolation (raises, curls, pushdowns, leg curls, calf raises), core and conditioning last. Finish every set of one exercise before the next.";
const AVOID_LABELS = { knees: "knees", lower_back: "lower back", shoulders: "shoulders", wrists: "wrists" };
const AVOID_RULES = {
  knees: "Avoid jumps, deep lunges and very deep squats; prefer box squats, leg press with controlled range, hamstring and glute work.",
  lower_back: "Avoid heavy deadlifts and unsupported bent-over rows; prefer chest-supported rows, machine and core-bracing work.",
  shoulders: "Avoid behind-the-neck presses, dips and very wide-grip pressing; prefer neutral-grip and landmine-style pressing.",
  wrists: "Avoid push-ups on flat palms and heavy straight-bar curls; prefer dumbbells, neutral grips and machines.",
};

/** "Height: 180cm, Weight: 80kg", or what's missing. */
function bodyContext({ height, weight }) {
  if (height && weight) return `Height: ${height}cm, Weight: ${weight}kg`;
  if (height) return `Height: ${height}cm, Weight: not provided`;
  if (weight) return `Weight: ${weight}kg, Height: not provided`;
  return "Height and weight not provided — build plan based on goal and age only";
}

const INTENSITY_NOTES = {
  conservative: "Start at 50-60% estimated 1RM. Increase load only every 2 weeks. Prioritise form over weight.",
  moderate: "Start at 65-70% estimated 1RM. Increase load weekly when all sets are completed cleanly.",
  aggressive: "Start at 75-80% estimated 1RM. Push to near failure on final set. Increase load as soon as all sets are clean.",
};

/**
 * Week 1 of a new plan. The week itself (which days, which session, which
 * muscles) comes from planSchedule.planSettings; the AI only picks the
 * exercises for each training day. `recent` is the last workouts, one line each.
 */
function buildFirstWeekPrompt(profile, settings, recent = []) {
  const { minutes, equipment, experience, split, progression, intensity, priorityMuscles, schedule, totalWeeks } = settings;
  const avoidAreas = Array.isArray(profile.avoidAreas) ? profile.avoidAreas : [];
  const avoid = avoidAreas.length > 0
    ? `${avoidAreas.map((a) => AVOID_LABELS[a] || a).join(", ")}. ${avoidAreas.map((a) => AVOID_RULES[a]).filter(Boolean).join(" ")}`
    : "nothing";
  const maxExercises = minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 7 : 8;
  const restBetweenSets = minutes <= 45 ? "45-60s" : "60-120s";
  const week = schedule.map((s) => `- ${WEEKDAY_NAMES[WEEKDAYS.indexOf(s.day)]}: ${s.session} (${s.muscles.join(", ")})`).join("\n");

  return `You are an elite personal trainer writing week 1 of a ${totalWeeks}-week workout plan for an Iron Arc fitness app user. Later weeks are written one at a time from what the user logs.

USER
- Age: ${profile.age ?? "not provided"}
- ${bodyContext(profile)}
- Goal: ${profile.fitnessGoal}
- Experience: ${experience}
- Equipment: ${equipment.replace(/_/g, " ")}
- Session length: ${minutes} minutes
- Split: ${SPLIT_NAMES[split]}
- Progression: ${progression}. ${PROGRESSION_RULES[progression]}
- Intensity: ${intensity}. ${INTENSITY_NOTES[intensity] || INTENSITY_NOTES.moderate}
- Priority muscles (1-2 extra sets each): ${priorityMuscles.length > 0 ? priorityMuscles.join(", ") : "none"}
- Go easy on: ${avoid}

RECENT WORKOUTS (date, exercise: weight kg × reps per set)
${recent.length > 0 ? recent.join("\n") : "None — new user. Start conservatively."}

THIS WEEK — fixed by the app. Write exercises for exactly these training days; every other day is a rest day.
${week}

RULES
1. Each session fits in ${minutes} minutes: at most ${maxExercises} exercises, ${restBetweenSets} rest between sets.
2. Train the listed muscles on each day. A session that repeats (e.g. two Push days) trains the same muscles; vary one or two exercises if you like.
3. Experience: beginner 2-3 sets, compound movements first, avoid failure; intermediate 3-4 sets, compound + isolation, 1-2 reps in reserve; advanced 4-5 sets, drop sets and supersets allowed, closer to failure.
4. Rep ranges by goal: strength 3-5 reps, 3-5 min rest; muscle 6-12 reps, 60-90s rest; endurance 15-20 reps, 30-45s rest; weight-loss 10-15 reps, 45-60s rest; general fitness 8-12 reps, 60s rest.
5. ${ORDER_RULE}
6. Exercise ids only from: ${allowedExerciseIds(equipmentTagsFor(equipment)).join(", ")}.
7. "progressionNote": one short line on how to progress that exercise next week.
8. "planExplanation": 2 sentences on why this split and progression suit the user.

Return ONLY this JSON, no markdown, with one entry per training day listed above, in order:
{"planExplanation": "...", "days": [{"day": "monday", "exercises": [{"exerciseId": "bench_press", "name": "Barbell Bench Press", "sets": 4, "reps": "6-8", "restSeconds": 90, "progressionNote": "Add 2.5 kg when all sets reach 8 reps"}]}]}`;
}

/**
 * Next week, adjusted to what the user actually logged. Same compact week format as the
 * coach chat so it fits the model's per-minute token limit.
 * meta: { weekNumber, totalWeeks, progression, deload, exerciseIds } (ids the user's equipment allows).
 */
function buildNextWeekPrompt(thisWeek, nextWeek, logged, profile = {}, meta = {}) {
  const profileSummary = [
    profile.fitnessGoal && `Goal: ${profile.fitnessGoal}`,
    profile.experienceLevel && `Experience: ${profile.experienceLevel}`,
    profile.equipment && `Equipment: ${profile.equipment}`,
  ].filter(Boolean).join(" · ") || "Not provided";

  return `You are a personal trainer preparing next week's sessions from what the user actually did this week.

PROFILE: ${profileSummary}
PLAN: next week is week ${meta.weekNumber + 1} of ${meta.totalWeeks}. Progression: ${PROGRESSION_RULES[meta.progression] || "Add weight progressively each week."}${meta.deload ? " Next week is a deload week: about 60% of the usual load and one set fewer per exercise." : ""}
Short keys: d=day, t=rest, m=muscles, min=minutes, x=exercises with id, n=name, s=sets, r=reps, rest=seconds.
THIS WEEK (week ${meta.weekNumber}) AS PLANNED:
${JSON.stringify(thisWeek)}

LOGGED IN THE LAST 7 DAYS (date, exercise: weight kg × reps per set):
${logged.length > 0 ? logged.join("\n") : "Nothing logged."}

NEXT WEEK (week ${meta.weekNumber + 1}) AS PLANNED:
${JSON.stringify(nextWeek)}

RULES:
- Keep the same training days and split, and follow the plan's progression above.
- An exercise done with all its reps: progress it (one more rep in the range, or one more set if reps are at the top).
- An exercise with missed reps or skipped: keep it the same or ease off one set.
- Most of the week missed: reduce next week's volume about 15%.
- ${ORDER_RULE}
- Exercise ids only from: ${meta.exerciseIds.join(", ")}.
- "modifiedDays": next week, all 7 days Monday to Sunday in the same short-key format, rest days as {"d":"<day>","t":"rest"}. Use null if next week is right as planned.
- "message": 1–3 friendly sentences on what you changed for next week and why, based on the log.

Return ONLY this JSON, no markdown:
{"message": "...", "modifiedDays": null}`;
}

function buildSubstitutePrompt(exerciseId, reason, anonymizedProfile, exerciseIds) {
  return `
You are a fitness expert helping an Iron Arc user substitute an exercise.

Exercise to replace: ${exerciseId}
Reason: ${reason || "not given"}
User goal: ${anonymizedProfile.fitnessGoal}

VALID EXERCISE IDs — ONLY USE THESE:
${exerciseIds.join(", ")}

Rules:
- Must be a DIFFERENT exercise from the one being replaced
- Same primary muscle group
- Respect the reason (e.g. "no barbell" → dumbbells, cables or machines; "hurts my shoulder" → a gentler option)
- Common gym equipment is fine
- Appropriate difficulty for the user's goal
- MUST use an exerciseId from the valid list above

Return ONLY valid JSON:
{
  "substituteExerciseId": "exercise_id",
  "substituteName": "Exercise Name",
  "reason": "Why this is the best substitute"
}
`;
}

/**
 * Coach chat. Sends one compact week (short keys, no indentation) instead of the
 * whole multi-week plan: the full pretty-printed plan was ~9,600 tokens, over the
 * model's 8,000 tokens-per-minute limit. The AI answers with the changed days only.
 *
 * Week format (short keys):
 *   rest day:     { "d": "tuesday", "t": "rest" }
 *   training day: { "d": "monday", "m": ["chest"], "min": 60,
 *                   "x": [{ "id": "bench_press", "n": "Barbell Bench Press", "s": 4, "r": "6-8", "rest": 90 }] }
 */
/** meta: { weeks, weekNumber, exerciseIds } (the ids the user's equipment allows). */
function buildPlanChatPrompt(weekDays, history = [], userMessage, profile = {}, meta = {}) {
  const recentHistory = history.slice(-6);
  const historyText = recentHistory.length > 0
    ? recentHistory.map(m => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`).join("\n")
    : "None.";

  const profileSummary = [
    profile.fitnessGoal && `Goal: ${profile.fitnessGoal}`,
    profile.age && `Age: ${profile.age}`,
    profile.experienceLevel && `Experience: ${profile.experienceLevel}`,
    profile.equipment && `Equipment: ${profile.equipment}`,
    profile.sessionMinutes && `Session: ${profile.sessionMinutes} min`,
  ].filter(Boolean).join(" · ") || "Not provided";

  return `You are a personal trainer coaching a user through chat about their weekly workout plan.

PROFILE: ${profileSummary}
PLAN: ${meta.weeks || 1} week(s); the user is on week ${meta.weekNumber || 1}. This is that week (short keys: d=day, t=rest, m=muscles, min=minutes, x=exercises with id, n=name, s=sets, r=reps, rest=seconds):
${JSON.stringify(weekDays)}

RECENT CHAT:
${historyText}

USER: "${userMessage}"

RULES:
- To CHANGE the plan (days, exercises, sets, reps, rest, session length): return the full week in the same short-key format as "modifiedDays", all 7 days Monday to Sunday, rest days as {"d":"<day>","t":"rest"}. It replaces this week and the weeks after it.
- To ANSWER a question (technique, nutrition, motivation): return "modifiedDays": null.
- Never train the same muscle group on consecutive days. Keep sessions within the minutes given.
- ${ORDER_RULE}
- Exercise ids only from: ${meta.exerciseIds.join(", ")}.
- "message": 1–3 friendly sentences, like a real coach, saying what you changed or answering.

Return ONLY this JSON, no markdown:
{"message": "...", "modifiedDays": null}`;
}

module.exports = {
  buildFirstWeekPrompt,
  buildNextWeekPrompt,
  buildSubstitutePrompt,
  buildPlanChatPrompt,
};
