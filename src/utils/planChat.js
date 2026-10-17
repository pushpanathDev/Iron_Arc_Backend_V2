/**
 * Plan coach helpers. The AI gets one compact week (not the whole multi-week
 * plan, which exceeded the model's tokens-per-minute limit) and answers with
 * the changed days only; the server applies them to the current and later weeks.
 *
 * The coach chat itself is kept inside the plan data, as planData._chatHistory
 * (newest last), so a plan and its conversation are saved together.
 */

const { addDays, withWeekday } = require("./dates");

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const CHAT_HISTORY_MAX = 40;

/** The week the user is on (1-based), clamped to the weeks the plan has. */
function currentWeekIndex(planData, weekNumber) {
  const weeks = Array.isArray(planData?.weeks) ? planData.weeks : [];
  return Math.min(Math.max((weekNumber || 1) - 1, 0), Math.max(weeks.length - 1, 0));
}

/**
 * One week in short keys — just what the coach needs to reason about:
 * [{ d: "monday", t: "rest" }, { d: "tuesday", m: ["chest"], min: 60, x: [{ id, n, s, r, rest }] }]
 */
function compactWeek(planData, weekNumber) {
  const weeks = Array.isArray(planData?.weeks) ? planData.weeks : [];
  const week = weeks[currentWeekIndex(planData, weekNumber)];
  const days = Array.isArray(week?.days) ? week.days : [];
  return days.map((day) =>
    day.sessionType === "rest"
      ? { d: day.day, t: "rest" }
      : {
          d: day.day,
          m: day.targetMuscles || [],
          min: day.estimatedDurationMinutes,
          x: (day.exercises || []).map((e) => ({ id: e.exerciseId, n: e.name, s: e.sets, r: e.reps, rest: e.restSeconds })),
        },
  );
}

/** The coach's short-key days → the plan's day format (exercise details kept where the exercise stays). */
function expandDays(shortDays, previousDays = []) {
  const byDay = new Map(previousDays.map((d) => [String(d.day || "").toLowerCase(), d]));
  const days = shortDays
    .filter((d) => d && typeof d.d === "string")
    .map((d) => {
      const key = d.d.toLowerCase();
      if (d.t === "rest" || !Array.isArray(d.x) || d.x.length === 0) {
        return { day: key, sessionType: "rest", recoveryNote: byDay.get(key)?.recoveryNote || "Rest and recover." };
      }
      const before = new Map((byDay.get(key)?.exercises || []).map((e) => [e.exerciseId, e]));
      return {
        day: key,
        sessionType: "training",
        targetMuscles: Array.isArray(d.m) ? d.m : [],
        estimatedDurationMinutes: Number(d.min) || byDay.get(key)?.estimatedDurationMinutes || 45,
        exercises: d.x.map((x) => {
          const kept = before.get(x.id) || {};
          const sets = Number(x.s) || kept.sets || 3;
          const reps = String(x.r ?? kept.reps ?? "8-12");
          // Its note was written for the old sets and reps; the validator writes a fitting one.
          const { progressionNote, ...rest } = kept;
          const unchanged = sets === kept.sets && reps === String(kept.reps);
          return {
            ...(unchanged ? kept : rest),
            exerciseId: x.id || kept.exerciseId,
            name: x.n || kept.name,
            sets,
            reps,
            restSeconds: Number(x.rest) || kept.restSeconds || 90,
          };
        }),
      };
    });
  // Every weekday, in order. A day the coach left out keeps what it was; one the plan never had is a rest day.
  return WEEKDAYS.map((key) => days.find((d) => d.day === key) || byDay.get(key) || { day: key, sessionType: "rest", recoveryNote: "Rest and recover." });
}

/**
 * Apply the coach's changed week to the current week and every week after it (earlier weeks are history).
 * `onlyThisWeek` (next-week adjustments) leaves the later weeks as planned.
 */
function applyWeekChange(planData, weekNumber, shortDays, { onlyThisWeek = false } = {}) {
  const weeks = Array.isArray(planData?.weeks) ? planData.weeks : [];
  const from = currentWeekIndex(planData, weekNumber);
  return {
    ...planData,
    weeks: weeks.map((week, i) =>
      i < from || (onlyThisWeek && i > from) ? week : { ...week, days: expandDays(shortDays, week.days || []) },
    ),
  };
}

const matchKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A plan week on its calendar week (from `monday`), one line per training day,
 * so the coach talks about what really happened, e.g.
 *   "Mon 2026-10-12 · Push: logged (6 of 7 exercises)"
 *   "Tue 2026-10-13 · Pull: not logged"
 *   "Sat 2026-10-17 · Legs: coming up"
 * A day counts an exercise as logged when one with its name was saved for that
 * date. `sessionName` names a day ("Push"); `workouts` are { date: "YYYY-MM-DD", exercise }.
 */
function weekSoFar(weekDays, workouts, monday, today, sessionName) {
  const loggedOn = new Map();
  for (const w of workouts) {
    if (!loggedOn.has(w.date)) loggedOn.set(w.date, new Set());
    loggedOn.get(w.date).add(matchKey(w.exercise));
  }

  return WEEKDAYS.flatMap((key, i) => {
    const day = (weekDays ?? []).find((d) => d.day?.toLowerCase() === key);
    if (!day || day.sessionType === "rest" || !(day.exercises?.length > 0)) return [];
    const date = addDays(monday, i);
    const label = `${withWeekday(date)} · ${sessionName(day)}`;
    if (date > today) return [`${label}: coming up`];
    const logged = loggedOn.get(date);
    const done = day.exercises.filter((e) => logged?.has(matchKey(e.name ?? "")) || logged?.has(matchKey(e.exerciseId ?? ""))).length;
    if (done > 0) return [`${label}: logged (${done} of ${day.exercises.length} exercises)`];
    return [`${label}: ${date === today ? "not logged yet (today)" : "not logged"}`];
  });
}

/** The coach's days if the AI changed the week, else null. */
function changedDays(aiReply) {
  return Array.isArray(aiReply?.modifiedDays) && aiReply.modifiedDays.length > 0 ? aiReply.modifiedDays : null;
}

/** The plan's coach chat, oldest first. */
function chatOf(planData) {
  return Array.isArray(planData?._chatHistory) ? planData._chatHistory : [];
}

/** The plan without its chat: what the AI and the validator work on. */
function withoutChat(planData) {
  const { _chatHistory, ...plan } = planData ?? {};
  return plan;
}

/** The plan with its chat: the earlier history plus new entries, keeping the last 40. */
function withChat(plan, history, newEntries) {
  return { ...plan, _chatHistory: [...history, ...newEntries].slice(-CHAT_HISTORY_MAX) };
}

module.exports = {
  WEEKDAYS,
  weekSoFar,
  currentWeekIndex,
  compactWeek,
  expandDays,
  applyWeekChange,
  changedDays,
  chatOf,
  withoutChat,
  withChat,
};
