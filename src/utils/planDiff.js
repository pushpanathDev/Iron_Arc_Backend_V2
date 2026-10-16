/**
 * Plain-words differences for one week of a plan, saved with the coach's
 * chat messages so the "Plan updated" card survives reopening the chat.
 * Mirrors diffPlanWeek in the app (utils/planData.ts).
 */
const { WEEKDAYS, currentWeekIndex } = require('./planChat');

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const weekDays = (planData, weekNumber) => planData?.weeks?.[currentWeekIndex(planData, weekNumber)]?.days ?? [];

const byWeekday = (days) => WEEKDAYS.map((k) => days.find((d) => (d.day || '').toLowerCase() === k) ?? null);
const isTraining = (d) => !!d && d.sessionType !== 'rest' && (d.exercises?.length ?? 0) > 0;
const exKey = (e) => (e.name ?? e.exerciseId ?? '').trim().toLowerCase();
const scheme = (e) => `${e.sets ?? '?'}×${e.reps ?? '?'}`;

/** "Push", "Legs", "Upper": a short session name from its muscles. */
function dayShortName(day) {
  if (day.name) return day.name;
  const m = new Set((day.targetMuscles ?? []).map((x) => x.toLowerCase()));
  const has = (...keys) => keys.some((k) => m.has(k));
  if (has('legs', 'quads', 'hamstrings', 'glutes', 'calves') && !has('chest', 'back', 'shoulders')) return 'Legs';
  if (has('chest', 'triceps') && !has('back', 'biceps', 'lats')) return 'Push';
  if (has('back', 'lats', 'biceps') && !has('chest', 'triceps')) return 'Pull';
  if (has('chest') && has('back')) return has('legs', 'quads', 'hamstrings', 'glutes') ? 'Full body' : 'Upper';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return (day.targetMuscles ?? []).slice(0, 2).map(cap).join('/') || 'Workout';
}

/**
 * @returns {{ dayIndex: number, text: string }[]} Monday first, e.g.
 *   "Wed is now a rest day", "Thu: Squat → Leg Press", "Mon: + Lateral Raise", "Tue: Row 4×8 → 3×10"
 */
function diffPlanWeek(before, after, weekNumber) {
  const a = byWeekday(weekDays(before, weekNumber));
  const b = byWeekday(weekDays(after, weekNumber));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const was = a[i];
    const now = b[i];
    const day = DAY_SHORT[i];
    if (isTraining(was) && !isTraining(now)) {
      out.push({ dayIndex: i, text: `${day} is now a rest day` });
      continue;
    }
    if (!isTraining(was) && isTraining(now)) {
      const n = now.exercises.length;
      out.push({ dayIndex: i, text: `${day}: ${dayShortName(now)}, ${n} ${n === 1 ? 'exercise' : 'exercises'}` });
      continue;
    }
    if (!isTraining(was) || !isTraining(now)) continue;

    const old = new Map(was.exercises.map((e) => [exKey(e), e]));
    const cur = new Map(now.exercises.map((e) => [exKey(e), e]));
    const removed = [...old.keys()].filter((k) => !cur.has(k));
    const added = [...cur.keys()].filter((k) => !old.has(k));
    const swaps = Math.min(removed.length, added.length);
    for (let s = 0; s < swaps; s++) out.push({ dayIndex: i, text: `${day}: ${old.get(removed[s]).name} → ${cur.get(added[s]).name}` });
    for (const k of added.slice(swaps)) out.push({ dayIndex: i, text: `${day}: + ${cur.get(k).name}` });
    for (const k of removed.slice(swaps)) out.push({ dayIndex: i, text: `${day}: − ${old.get(k).name}` });
    for (const [k, e] of cur) {
      const prev = old.get(k);
      if (prev && scheme(prev) !== scheme(e)) out.push({ dayIndex: i, text: `${day}: ${e.name} ${scheme(prev)} → ${scheme(e)}` });
    }
  }
  return out;
}

module.exports = { diffPlanWeek };
