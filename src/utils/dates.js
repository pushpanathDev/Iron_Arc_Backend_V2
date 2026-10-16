/*
 * Calendar-day keys ("YYYY-MM-DD") and the arithmetic on them, in UTC so the
 * server's own timezone never shifts a day. Workout dates are stored as plain
 * dates, so a key is the user's own calendar day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The key of a Date (or of today). */
const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const addDays = (key, days) => dateKey(new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS));

/** 0 = Monday … 6 = Sunday. */
const weekdayOf = (key) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;

/** "Mon 2026-10-12" */
const withWeekday = (key) => `${SHORT_WEEKDAYS[weekdayOf(key)]} ${key}`;

module.exports = { dateKey, addDays, weekdayOf, withWeekday };
