const { prisma } = require("../config/database");

async function createWorkout(userId, data) {
  const workout = await prisma.workout.create({
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
  });

  return workout;
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
  const existing = await prisma.workout.findFirst({
    where: { id: workoutId, userId, deletedAt: null },
  });

  if (!existing) return null;

  const updateData = {};
  if (data.date) updateData.date = new Date(data.date);
  if (data.exercise) updateData.exercise = data.exercise;
  if (data.category) updateData.category = data.category;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  if (data.sets) {
    await prisma.workoutSet.deleteMany({ where: { workoutId } });
    updateData.sets = {
      create: data.sets.map((set, idx) => ({
        setNumber: idx + 1,
        reps: set.reps,
        weight: set.weight || 0,
      })),
    };
  }

  const workout = await prisma.workout.update({
    where: { id: workoutId },
    data: updateData,
    include: { sets: { orderBy: { setNumber: "asc" } } },
  });

  return workout;
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

  return workout;
}

async function getRecentWorkouts(userId, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return prisma.workout.findMany({
    where: {
      userId,
      deletedAt: null,
      date: { gte: since },
    },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "desc" },
  });
}

module.exports = {
  createWorkout,
  getWorkouts,
  getWorkoutById,
  updateWorkout,
  deleteWorkout,
  getRecentWorkouts,
};
