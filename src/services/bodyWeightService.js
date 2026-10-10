const { prisma } = require("../config/database");
const { evaluateAchievementsSafely } = require("./achievementService");

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
  const where = {
    userId,
    deletedAt: null,
  };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [weights, total] = await Promise.all([
    prisma.bodyWeight.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bodyWeight.count({ where }),
  ]);

  return { weights, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function deleteWeight(userId, weightId) {
  const existing = await prisma.bodyWeight.findFirst({
    where: { id: weightId, userId, deletedAt: null },
  });

  if (!existing) return null;

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

/** Aggregate body-weight stats over all non-deleted entries (kg). */
async function getWeightStats(userId) {
  const entries = await prisma.bodyWeight.findMany({
    where: { userId, deletedAt: null },
    select: { date: true, weight: true },
    orderBy: { date: "asc" },
  });

  const first = entries[0] ?? null;
  const latest = entries[entries.length - 1] ?? null;
  const dateKey = (d) => d.toISOString().slice(0, 10);

  return {
    latestWeight: latest ? latest.weight : null,
    latestDate: latest ? dateKey(latest.date) : null,
    firstWeight: first ? first.weight : null,
    firstDate: first ? dateKey(first.date) : null,
    totalEntries: entries.length,
    distinctDays: new Set(entries.map((e) => dateKey(e.date))).size,
  };
}

async function getLatestWeight(userId) {
  return prisma.bodyWeight.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { date: "desc" },
  });
}

module.exports = {
  logWeight,
  getWeights,
  deleteWeight,
  getWeightStats,
  getLatestWeight,
};
