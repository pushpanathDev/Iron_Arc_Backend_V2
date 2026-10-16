const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");
const { HttpError } = require("../utils/httpError");

async function createExercise(userId, data) {
  let exercise;
  try {
    exercise = await prisma.customExercise.create({
      data: { userId, category: data.category, name: data.name },
    });
  } catch (error) {
    if (error.code === "P2002") throw new HttpError(409, "Exercise already exists in this category");
    throw error;
  }

  const newlyUnlocked = await evaluateAchievementsSafely(userId, "custom_exercise");
  return { exercise, newlyUnlocked };
}

async function getExercises(userId, category) {
  const where = { userId };
  if (category) where.category = category;

  return prisma.customExercise.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

async function deleteExercise(userId, exerciseId) {
  const existing = await prisma.customExercise.findFirst({
    where: { id: exerciseId, userId },
  });

  if (!existing) throw new HttpError(404, "Exercise not found");

  await prisma.customExercise.delete({ where: { id: exerciseId } });
}

module.exports = {
  createExercise,
  getExercises,
  deleteExercise,
};
