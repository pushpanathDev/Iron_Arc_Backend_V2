const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");

async function createExercise(userId, data) {
  const exercise = await prisma.customExercise.create({
    data: {
      userId,
      category: data.category,
      name: data.name,
    },
  });

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

  if (!existing) return null;

  await prisma.customExercise.delete({ where: { id: exerciseId } });
  return existing;
}

module.exports = {
  createExercise,
  getExercises,
  deleteExercise,
};
