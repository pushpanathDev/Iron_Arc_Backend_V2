const { prisma } = require("../config/database");

async function logWeight(userId, data) {
  const date = new Date(data.date);

  const entry = await prisma.bodyWeight.upsert({
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

  return entry;
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

  const entry = await prisma.bodyWeight.update({
    where: { id: weightId },
    data: { deletedAt: new Date() },
  });

  return entry;
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
  getLatestWeight,
};
