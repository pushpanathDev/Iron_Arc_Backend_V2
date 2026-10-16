const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");
const { HttpError } = require("../utils/httpError");
const { dateRange, pageResult } = require("../utils/paging");

const notFound = () => new HttpError(404, "Workout not found");
const withSets = { sets: { orderBy: { setNumber: "asc" } } };

/** Sets as rows, numbered from 1 in the order they were logged. */
const setRows = (sets) => sets.map((set, i) => ({ setNumber: i + 1, reps: set.reps, weight: set.weight || 0 }));

/** A new workout row with its sets, on `date`. */
const newWorkout = (userId, date, entry) => ({
  userId,
  date: new Date(date),
  exercise: entry.exercise,
  category: entry.category,
  notes: entry.notes || null,
  sets: { create: setRows(entry.sets || []) },
});

async function createWorkout(userId, data) {
  const workout = await prisma.workout.create({ data: newWorkout(userId, data.date, data), include: withSets });

  // After the save and best-effort: an evaluation failure is logged and never
  // turns this successful save into an error response.

  // After commit and best-effort: an evaluation failure is logged and never
  // turns this successful save into an error response.
  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workout, newlyUnlocked };
}

/**
 * Several workouts (one logged session) in ONE transaction: every entry is
 * saved or none is. Entries are created in order; returns the created
 * records (with sets) in the same order. Achievements are evaluated once,
 * after commit, best-effort (see createWorkout).
 */
async function createWorkoutBatch(userId, { date, entries }) {
  const workouts = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const entry of entries) {
      created.push(await tx.workout.create({ data: newWorkout(userId, date, entry), include: withSets }));
    }
    return created;
  });

  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workouts, newlyUnlocked };
}

async function getWorkouts(userId, { page = 1, limit = 20, category, startDate, endDate } = {}) {
  const where = { userId, deletedAt: null, category: category || undefined, date: dateRange(startDate, endDate) };

  const [workouts, total] = await Promise.all([
    prisma.workout.findMany({
      where,
      include: withSets,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.workout.count({ where }),
  ]);

  return pageResult("workouts", workouts, total, { page, limit });
}

async function getWorkout(userId, workoutId) {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId, deletedAt: null },
    include: withSets,
  });
  if (!workout) throw notFound();
  return workout;
}

async function updateWorkout(userId, workoutId, data) {
  const updateData = {};
  if (data.date) updateData.date = new Date(data.date);
  if (data.exercise) updateData.exercise = data.exercise;
  if (data.category) updateData.category = data.category;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  if (data.sets) {
    updateData.sets = { create: setRows(data.sets) };
  }

  // Ownership check, set replacement and update in one transaction: if any
  // step fails, nothing is written and the old sets are kept.
  const workout = await prisma.$transaction(async (tx) => {
    const existing = await tx.workout.findFirst({
      where: { id: workoutId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return null;

    if (data.sets) {
      await tx.workoutSet.deleteMany({ where: { workoutId } });
    }

    return tx.workout.update({
      where: { id: workoutId },
      data: updateData,
      include: withSets,
    });
  });

  if (!workout) throw notFound();

  // After commit and best-effort (see createWorkout).
  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workout, newlyUnlocked };
}

async function deleteWorkout(userId, workoutId) {
  const existing = await prisma.workout.findFirst({
    where: { id: workoutId, userId, deletedAt: null },
  });
  if (!existing) throw notFound();

  const workout = await prisma.workout.update({
    where: { id: workoutId },
    data: { deletedAt: new Date() },
  });

  // Deletes are a trigger too. Evaluation is append-only, so a delete can
  // never revoke a badge that was already earned.
  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workout, newlyUnlocked };
}

module.exports = {
  createWorkoutBatch,
  createWorkout,
  getWorkouts,
  getWorkout,
  updateWorkout,
  deleteWorkout,
};
