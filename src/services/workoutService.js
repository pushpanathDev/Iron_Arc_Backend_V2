const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");

async function createWorkout(userId, data) {
  // Workout + sets are written atomically.
  const workout = await prisma.$transaction((tx) =>
    tx.workout.create({
      data: {
        userId,
        date: new Date(data.date),
        exercise: data.exercise,
        category: data.category,
        notes: data.notes || null,
        sets: {
          create: (data.sets || []).map((set, idx) => ({
            setNumber: idx + 1,
            reps: set.reps,
            weight: set.weight || 0,
          })),
        },
      },
      include: { sets: true },
    }),
  );

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
      created.push(
        await tx.workout.create({
          data: {
            userId,
            date: new Date(date),
            exercise: entry.exercise,
            category: entry.category,
            notes: entry.notes || null,
            sets: {
              create: (entry.sets || []).map((set, idx) => ({
                setNumber: idx + 1,
                reps: set.reps,
                weight: set.weight || 0,
              })),
            },
          },
          include: { sets: { orderBy: { setNumber: "asc" } } },
        }),
      );
    }
    return created;
  });

  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workouts, newlyUnlocked };
}

async function getWorkouts(userId, { page = 1, limit = 20, category, startDate, endDate } = {}) {
  const where = {
    userId,
    deletedAt: null,
  };

  if (category) where.category = category;
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [workouts, total] = await Promise.all([
    prisma.workout.findMany({
      where,
      include: { sets: { orderBy: { setNumber: "asc" } } },
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.workout.count({ where }),
  ]);

  return { workouts, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function getWorkoutById(userId, workoutId) {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId, deletedAt: null },
    include: { sets: { orderBy: { setNumber: "asc" } } },
  });

  return workout;
}

async function updateWorkout(userId, workoutId, data) {
  const updateData = {};
  if (data.date) updateData.date = new Date(data.date);
  if (data.exercise) updateData.exercise = data.exercise;
  if (data.category) updateData.category = data.category;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  if (data.sets) {
    updateData.sets = {
      create: data.sets.map((set, idx) => ({
        setNumber: idx + 1,
        reps: set.reps,
        weight: set.weight || 0,
      })),
    };
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
      include: { sets: { orderBy: { setNumber: "asc" } } },
    });
  });

  if (!workout) return null;

  // After commit and best-effort (see createWorkout).
  const newlyUnlocked = await evaluateAchievementsSafely(userId, "workout");
  return { workout, newlyUnlocked };
}

async function deleteWorkout(userId, workoutId) {
  const existing = await prisma.workout.findFirst({
    where: { id: workoutId, userId, deletedAt: null },
  });

  if (!existing) return null;

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
  getWorkoutById,
  updateWorkout,
  deleteWorkout,
};
