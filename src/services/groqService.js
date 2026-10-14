/**
 * AI Service — powered by Groq (Llama 3.3 70B)
 *
 * Groq provides a generous free tier (1,000+ RPD) with Llama 3.3 70B,
 * which is excellent at structured JSON generation for workout plans.
 *
 * Exported functions are consumed by planningService.js.
 */
const { groqClient, GROQ_MODEL } = require('../config/groq');

/* ─────────────────────────────────────────────────────────────
   Core caller with retry + Retry-After awareness
───────────────────────────────────────────────────────────── */

/**
 * Extract the Retry-After delay from a 429 response header or error message.
 * Groq returns a `retry-after` header (seconds) on 429s.
 */
function extractRetryDelaySecs(error) {
  // Check headers (Groq SDK surfaces them on the error object)
  const retryAfter = error?.headers?.['retry-after'];
  if (retryAfter) return parseFloat(retryAfter);

  // Fallback: scan message for retryDelay JSON
  const match = (error?.message || '').match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match) return parseFloat(match[1]);

  return null;
}

/**
 * @param {string} prompt
 * @param {number} [maxRetries]
 * @param {{ maxTokens?: number }} [options] smaller replies (chat) stay well inside the
 *   free tier's tokens-per-minute limit.
 */
async function callGroqWithRetry(prompt, maxRetries = 2, options = {}) {
  let lastError;
  const maxAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert personal trainer. Always respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON object.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: options.maxTokens || 8192,
        response_format: { type: 'json_object' },
      });

      const text = completion.choices[0]?.message?.content || '';
      const usage = completion.usage || {};
      console.log(
        `[AI] attempt ${attempt}: finish=${completion.choices[0]?.finish_reason} · tokens in=${usage.prompt_tokens ?? '?'} out=${usage.completion_tokens ?? '?'} · ${text.length} chars`,
      );

      // Strip any accidental fences (defensive)
      const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned);
    } catch (error) {
      lastError = error;
      // 413 = the request itself is over the model's per-minute token limit: retrying
      // the same request can never succeed, so stop now.
      if (error?.status === 413) {
        console.warn(`[AI] Request too large (413), not retrying: ${error.message}`);
        throw new Error(`AI_REQUEST_TOO_LARGE: ${error.message}`);
      }
      const is429 = error?.status === 429 || (error?.message || '').includes('429');

      console.warn(`[AI] Attempt ${attempt}/${maxAttempts} failed: ${error.message}`);

      if (attempt < maxAttempts) {
        if (is429) {
          const serverDelaySecs = extractRetryDelaySecs(error) ?? 30;
          const waitMs = Math.min(serverDelaySecs * 1000, 60_000);
          console.warn(`[AI] Rate limited — waiting ${(waitMs / 1000).toFixed(0)}s before retry...`);
          await new Promise(r => setTimeout(r, waitMs));
        } else {
          // Non-rate-limit errors: exponential backoff (1s, 2s, 4s)
          await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
        }
      }
    }
  }

  throw new Error(`AI plan generation failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

/* ─────────────────────────────────────────────────────────────
  Prompt builders
───────────────────────────────────────────────────────────── */

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const AVOID_LABELS = { knees: 'knees', lower_back: 'lower back', shoulders: 'shoulders', wrists: 'wrists' };
const AVOID_RULES = {
  knees: 'Avoid jumps, deep lunges and very deep squats; prefer box squats, leg press with controlled range, hamstring and glute work.',
  lower_back: 'Avoid heavy deadlifts and unsupported bent-over rows; prefer chest-supported rows, machine and core-bracing work.',
  shoulders: 'Avoid behind-the-neck presses, dips and very wide-grip pressing; prefer neutral-grip and landmine-style pressing.',
  wrists: 'Avoid push-ups on flat palms and heavy straight-bar curls; prefer dumbbells, neutral grips and machines.',
};

/** Split from days per week when the user didn't choose one. */
function defaultSplit(days) {
  if (days <= 3) return 'full_body';
  if (days === 4) return 'upper_lower';
  return 'push_pull_legs';
}

/** Progression from experience when the user didn't choose one. */
function defaultProgression(experience) {
  return { beginner: 'linear', intermediate: 'undulating', advanced: 'block' }[experience] || 'linear';
}

function buildGeneratePlanPrompt(anonymizedProfile, recentWorkouts = [], criteria = {}) {
  const { age, height, weight, fitnessGoal } = anonymizedProfile;
  const trainingDays = Array.isArray(anonymizedProfile.trainingDays) ? anonymizedProfile.trainingDays : [];
  const avoidAreas = Array.isArray(anonymizedProfile.avoidAreas) ? anonymizedProfile.avoidAreas : [];
  // Chosen weekdays decide the session count when the user picked them.
  const weeklyGoal = trainingDays.length > 0 ? trainingDays.length : anonymizedProfile.weeklyGoal;

  const bodyContext = height && weight
    ? `Height: ${height}cm, Weight: ${weight}kg`
    : height
    ? `Height: ${height}cm, Weight: not provided`
    : weight
    ? `Weight: ${weight}kg, Height: not provided`
    : 'Height and weight not provided — build plan based on goal and age only';

  // ── Criteria: the plan form, else the user's training profile, else defaults ──
  const sessionDuration = criteria.sessionDuration ?? anonymizedProfile.sessionMinutes ?? 60;
  const equipment = criteria.equipment ?? anonymizedProfile.equipment ?? 'full_gym';
  const experienceLevel = criteria.experienceLevel ?? anonymizedProfile.experienceLevel ?? 'intermediate';
  // Split and progression follow from days and experience when not chosen.
  const splitPreference = criteria.splitPreference ?? defaultSplit(weeklyGoal);
  const progressionStyle = criteria.progressionStyle ?? defaultProgression(experienceLevel);
  const priorityMuscles = Array.isArray(criteria.priorityMuscles) && criteria.priorityMuscles.length > 0
    ? criteria.priorityMuscles
    : null;
  const intensity = criteria.intensity ?? 'moderate';
  const restDayLayout = criteria.restDayLayout ?? 'spread';

  // ── Equipment → exercise pool ─────────────────────────────────────────
  const exercisePool = equipment === 'bodyweight'
    ? 'push_up, bodyweight_squat, pull_up, tricep_dip, plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber, lunge'
    : equipment === 'dumbbells'
    ? 'dumbbell_press, incline_press, push_up, db_shoulder_press, lateral_raise, tricep_dip, dumbbell_row, bicep_curl, db_bicep_curl, goblet_squat, rdl, lunge, leg_curl, calf_raise, plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber'
    : 'bench_press, dumbbell_press, incline_press, push_up, overhead_press, db_shoulder_press, lateral_raise, tricep_dip, tricep_pushdown, pull_up, lat_pulldown, barbell_row, dumbbell_row, seated_cable_row, bicep_curl, db_bicep_curl, squat, goblet_squat, bodyweight_squat, deadlift, rdl, leg_press, lunge, leg_curl, calf_raise, plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber';

  // ── Progression style rules ───────────────────────────────────────────
  const progressionRules = {
    linear: 'Add 2.5–5kg (or 1 rep) to each exercise every week. If the user can complete all sets with perfect form, increase the load.',
    undulating: 'Week 1: heavy/low reps (4×4-6). Week 2: moderate/medium reps (4×8-10). Week 3: light/high reps (3×12-15). Week 4: deload (3×8 at 60% load). Repeat pattern with increased loads.',
    block: 'Phase 1 (weeks 1-4): hypertrophy focus, 3×10-12. Phase 2 (weeks 5-8): strength focus, 4×4-6 compound heavy. Phase 3 (weeks 9-12): peaking/intensification, 5×2-4. Then deload.'
  }[progressionStyle] || 'Add weight progressively each week.';

  // ── Intensity multiplier ──────────────────────────────────────────────
  const intensityNote = {
    conservative: 'Start at 50-60% estimated 1RM. Increase load only every 2 weeks. Prioritise form over weight.',
    moderate: 'Start at 65-70% estimated 1RM. Increase load weekly when all sets are completed cleanly.',
    aggressive: 'Start at 75-80% estimated 1RM. Push to near failure on final set. Increase load as soon as all sets are clean.'
  }[intensity] || 'Use moderate load progression.';

  // ── Rest day layout: the user's own weekdays when known ───────────────
  const dayNames = trainingDays.map((d) => WEEKDAY_NAMES[d - 1]).filter(Boolean);
  const restDayNote = dayNames.length > 0
    ? `Schedule the training days ONLY on: ${dayNames.join(', ')}. Every other day of the week is a rest day.`
    : {
    spread: 'Distribute rest days evenly between training days (e.g. Mon/Wed/Fri training, Tue/Thu rest).',
    weekends: 'Schedule all training days Mon–Fri and both rest days on Sat–Sun.',
    back_to_back: 'Group all rest days consecutively at the end of the training block (e.g. Fri-Sat-Sun rest).'
  }[restDayLayout] || 'Spread rest days evenly.';

  // ── Areas to go easy on ───────────────────────────────────────────────
  const avoidNote = avoidAreas.length > 0
    ? `The user asked to go easy on: ${avoidAreas.map((a) => AVOID_LABELS[a] || a).join(', ')}. ${avoidAreas.map((a) => AVOID_RULES[a]).filter(Boolean).join(' ')}`
    : null;

  // ── Exercise count based on session duration ──────────────────────────
  const maxExercises = sessionDuration <= 30 ? 4 : sessionDuration <= 45 ? 5 : sessionDuration <= 60 ? 7 : 9;
  const restBetweenSets = sessionDuration <= 45 ? '45-60s' : '60-120s';

  return `
You are an elite personal trainer building a highly personalised workout plan for an Iron Arc fitness app user.

═══════════════════════════════════════════════
USER PROFILE
═══════════════════════════════════════════════
- Age: ${age ?? 'not provided'}
- ${bodyContext}
- Primary Goal: ${fitnessGoal}
- Training Days Per Week: ${weeklyGoal}

═══════════════════════════════════════════════
USER-SELECTED PLAN CRITERIA
═══════════════════════════════════════════════
- Session Length: ${sessionDuration} minutes per session
- Equipment Available: ${equipment.replace(/_/g, ' ')}
- Experience Level: ${experienceLevel}
- Preferred Weekly Split: ${splitPreference.replace(/_/g, ' ')}
- Progression System: ${progressionStyle} progression
- Progression Intensity: ${intensity}
${priorityMuscles ? `- Priority Muscles (add 20-30% extra volume): ${priorityMuscles.join(', ')}` : '- No specific priority muscles'}
- Rest Days: ${dayNames.length > 0 ? `trains on ${dayNames.join(', ')}` : restDayLayout.replace(/_/g, ' ')}
${avoidAreas.length > 0 ? `- Go easy on: ${avoidAreas.map((a) => AVOID_LABELS[a] || a).join(', ')}` : '- No areas to avoid'}

═══════════════════════════════════════════════
RECENT WORKOUT HISTORY (last 5 sessions)
═══════════════════════════════════════════════
${recentWorkouts.length > 0 ? JSON.stringify(recentWorkouts, null, 2) : 'No history — new user. Start conservatively.'}

═══════════════════════════════════════════════
MANDATORY PLANNING RULES
═══════════════════════════════════════════════
1. SPLIT: Build the week using the "${splitPreference.replace(/_/g, ' ')}" split structure
2. SESSIONS: Generate exactly ${weeklyGoal} training days. Fill remaining days as rest
3. REST DAYS: ${restDayNote}
4. SESSION LENGTH: Each training session must fit within ${sessionDuration} minutes
5. EXERCISES PER SESSION: Maximum ${maxExercises} exercises per training day
6. REST BETWEEN SETS: ${restBetweenSets} (matching session length constraint)
7. EQUIPMENT: ONLY use exercises from the allowed pool below
8. EXPERIENCE:
   - beginner: 2-3 sets, compound movements first, avoid failure
   - intermediate: 3-4 sets, compound + isolation mix, 1-2 RIR
   - advanced: 4-5 sets, advanced techniques allowed (drop sets, supersets), train closer to failure
9. GOAL-BASED REP RANGES:
   - strength: 3-5 reps, 3-5 min rest, compound barbell lifts priority
   - muscle/hypertrophy: 6-12 reps, 60-90s rest, compound + isolation
   - endurance: 15-20 reps, 30-45s rest, circuit-friendly
   - weight-loss: 10-15 reps, 45-60s rest, full body compound focus
   - general fitness: 8-12 reps, 60s rest, balanced
10. PROGRESSION: ${progressionRules}
11. INTENSITY: ${intensityNote}
${priorityMuscles ? `12. PRIORITY MUSCLES: Add 1-2 extra sets for ${priorityMuscles.join(' and ')} compared to other muscle groups` : ''}
${avoidNote ? `12b. LIMITATIONS: ${avoidNote}\n` : ''}13. Never train the same muscle group on consecutive days
14. Include a planExplanation (3-4 sentences) explaining the split choice, progression logic, and how criteria were applied

═══════════════════════════════════════════════
ALLOWED EXERCISE IDs — ONLY USE THESE
═══════════════════════════════════════════════
${exercisePool}

═══════════════════════════════════════════════
OUTPUT FORMAT — RETURN ONLY VALID JSON
═══════════════════════════════════════════════
No markdown. No code fences. No explanation outside the JSON.

{
  "planExplanation": "3-4 sentence explanation of the plan design choices",
  "weeks": [
    {
      "week": 1,
      "isDeloadWeek": false,
      "days": [
        {
          "day": "monday",
          "sessionType": "training",
          "targetMuscles": ["chest", "triceps"],
          "estimatedDurationMinutes": ${sessionDuration},
          "exercises": [
            {
              "exerciseId": "bench_press",
              "name": "Barbell Bench Press",
              "sets": 4,
              "reps": "6-8",
              "restSeconds": 90,
              "targetWeight_kg": null,
              "progressionNote": "Add 2.5kg when all 4 sets complete",
              "substitutes": ["dumbbell_press", "push_up"]
            }
          ]
        },
        {
          "day": "tuesday",
          "sessionType": "rest",
          "recoveryNote": "Active recovery — walk, stretch, or foam roll"
        }
      ]
    }
  ]
}
`;
}

function buildRecalibratePlanPrompt(anonymizedProfile, currentPlan, recentWorkouts) {
  const completionRates = recentWorkouts.map(w => w.completionRate || 1);
  const avgCompletion = completionRates.length > 0
    ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
    : 1;

  return `
You are an expert personal trainer recalibrating an Iron Arc user's workout plan.

USER PROFILE:
${JSON.stringify(anonymizedProfile, null, 2)}

CURRENT PLAN SUMMARY:
- Current week: ${currentPlan.weekNumber || 1}
- Goal: ${anonymizedProfile.fitnessGoal}

RECENT PERFORMANCE (last 7 days):
${JSON.stringify(recentWorkouts, null, 2)}

AVERAGE COMPLETION RATE: ${(avgCompletion * 100).toFixed(0)}%

RECALIBRATION RULES:
- Completion > 90% AND no excessive fatigue reported → increase load or volume by 5-10%
- Completion < 70% OR high fatigue reported → reduce volume by 10-15%
- Any injury flag → remove affected exercises and substitute immediately
- Maintain the same weekly split structure unless completion < 50% (then simplify)
- Always include a recalibrationExplanation explaining what changed and why

VALID EXERCISE IDs — ONLY USE THESE:
bench_press, dumbbell_press, incline_press, push_up, overhead_press, db_shoulder_press,
lateral_raise, tricep_dip, tricep_pushdown, pull_up, lat_pulldown, barbell_row,
dumbbell_row, seated_cable_row, bicep_curl, db_bicep_curl, squat, goblet_squat,
bodyweight_squat, deadlift, rdl, leg_press, lunge, leg_curl, calf_raise,
plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber

Return ONLY valid JSON in the exact same structure as the plan format. No markdown. No code fences.
`;
}

function buildSubstitutePrompt(exerciseId, reason, anonymizedProfile) {
  return `
You are a fitness expert helping an Iron Arc user substitute an exercise.

Exercise to replace: ${exerciseId}
Reason: ${reason}
User goal: ${anonymizedProfile.fitnessGoal}

VALID EXERCISE IDs — ONLY USE THESE:
bench_press, dumbbell_press, incline_press, push_up, overhead_press, db_shoulder_press,
lateral_raise, tricep_dip, tricep_pushdown, pull_up, lat_pulldown, barbell_row,
dumbbell_row, seated_cable_row, bicep_curl, db_bicep_curl, squat, goblet_squat,
bodyweight_squat, deadlift, rdl, leg_press, lunge, leg_curl, calf_raise,
plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber

Rules:
- Same primary muscle group
- No equipment required if possible, or common gym equipment
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
 * buildPlanChatPrompt
 *
 * Generates a prompt for the plan customisation chat.
 * The AI can either answer a question (no plan change) or modify the plan.
 *
 * @param {object} planData  - Current plan JSON
 * @param {Array}  history   - Array of { role: 'user'|'assistant', content: string }
 * @param {string} userMessage - The new message from the user
 * @param {object} profile   - Anonymized user profile for context
 */
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
function buildPlanChatPrompt(weekDays, history = [], userMessage, profile = {}, meta = {}) {
  const recentHistory = history.slice(-6);
  const historyText = recentHistory.length > 0
    ? recentHistory.map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.content}`).join('\n')
    : 'None.';

  const profileSummary = [
    profile.fitnessGoal && `Goal: ${profile.fitnessGoal}`,
    profile.age && `Age: ${profile.age}`,
    profile.experienceLevel && `Experience: ${profile.experienceLevel}`,
    profile.equipment && `Equipment: ${profile.equipment}`,
    profile.sessionMinutes && `Session: ${profile.sessionMinutes} min`,
  ].filter(Boolean).join(' · ') || 'Not provided';

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
- Exercise ids only from: bench_press, dumbbell_press, incline_press, push_up, overhead_press, db_shoulder_press, lateral_raise, tricep_dip, tricep_pushdown, pull_up, lat_pulldown, barbell_row, dumbbell_row, seated_cable_row, bicep_curl, db_bicep_curl, squat, goblet_squat, bodyweight_squat, deadlift, rdl, leg_press, lunge, leg_curl, calf_raise, plank, crunch, leg_raise, russian_twist, jump_rope, burpee, mountain_climber.
- "message": 1–3 friendly sentences, like a real coach, saying what you changed or answering.

Return ONLY this JSON, no markdown:
{"message": "...", "modifiedDays": null}`;
}

module.exports = {
  callGroqWithRetry,
  buildGeneratePlanPrompt,
  buildRecalibratePlanPrompt,
  buildSubstitutePrompt,
  buildPlanChatPrompt,
};
