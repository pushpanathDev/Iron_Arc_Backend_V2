const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");
const { HttpError } = require("../utils/httpError");
const { dateRange, pageResult } = require("../utils/paging");

async function logWeight(userId, data) {
  const date = new Date(data.date);

  const entry = await prisma.$transaction(async (tx) => {
    const entry = await tx.bodyWeight.upsert({
      where: {
        userId_date: { userId, date },
      },
      update: {
        weight: data.weight,
        weekStart: data.weekStart ? new Date(data.weekStart) : null,
        deletedAt: null,
      },
      create: {
        userId,
        date,
        weight: data.weight,
        weekStart: data.weekStart ? new Date(data.weekStart) : null,
      },
    });

    await syncProfileWeight(tx, userId);
    return entry;
  });

  // After commit, outside the transaction: best-effort.
  const newlyUnlocked = await evaluateAchievementsSafely(userId, "weight");
  return { entry, newlyUnlocked };
}

async function syncProfileWeight(tx, userId) {
  const latestWeight = await tx.bodyWeight.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { date: "desc" },
  });

  await tx.user.update({
    where: { id: userId },
    data: { weight: latestWeight?.weight ?? null },
  });
}

async function getWeights(userId, { page = 1, limit = 30, startDate, endDate } = {}) {
  const where = { userId, deletedAt: null, date: dateRange(startDate, endDate) };

  const [weights, total] = await Promise.all([
    prisma.bodyWeight.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bodyWeight.count({ where }),
  ]);

  return pageResult("weights", weights, total, { page, limit });
}

async function deleteWeight(userId, weightId) {
  const existing = await prisma.bodyWeight.findFirst({
    where: { id: weightId, userId, deletedAt: null },
  });
  if (!existing) throw new HttpError(404, "Weight entry not found");

  const entry = await prisma.$transaction(async (tx) => {
    const updated = await tx.bodyWeight.update({
      where: { id: weightId },
      data: { deletedAt: new Date() },
    });

    await syncProfileWeight(tx, userId);
    return updated;
  });

  const newlyUnlocked = await evaluateAchievementsSafely(userId, "weight");
  return { entry, newlyUnlocked };
}

async function getLatestWeight(userId) {
  const entry = await prisma.bodyWeight.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { date: "desc" },
  });
  if (!entry) throw new HttpError(404, "No weight entries found");
  return entry;
}

module.exports = {
  logWeight,
  getWeights,
  deleteWeight,
  getLatestWeight,
};
