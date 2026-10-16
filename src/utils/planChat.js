/**
 * Plan coach helpers. The AI gets one compact week (not the whole multi-week
 * plan, which exceeded the model's tokens-per-minute limit) and answers with
 * the changed days only; the server applies them to the current and later weeks.
 *
 * The coach chat itself is kept inside the plan data, as planData._chatHistory
 * (newest last), so a plan and its conversation are saved together.
 */

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
          return {
            ...kept,
            exerciseId: x.id || kept.exerciseId,
            name: x.n || kept.name,
            sets: Number(x.s) || kept.sets || 3,
            reps: String(x.r ?? kept.reps ?? "8-12"),
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
  currentWeekIndex,
  compactWeek,
  expandDays,
  applyWeekChange,
  changedDays,
  chatOf,
  withoutChat,
  withChat,
};
