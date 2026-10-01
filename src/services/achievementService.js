const { prisma } = require("../config/database");

async function getAchievements(firebaseUid) {
  const user = await prisma.user.findUnique({ where: { firebaseUid } });
  if (!user) return [];

  return prisma.achievement.findMany({
    where: { userId: user.id },
    orderBy: { unlockedAt: "desc" },
  });
}

async function unlockAchievement(firebaseUid, badgeKey) {
  const user = await prisma.user.findUnique({ where: { firebaseUid } });
  if (!user) throw new Error("User not found");

  return prisma.achievement.upsert({
    where: { userId_badgeKey: { userId: user.id, badgeKey } },
    update: {},
    create: { userId: user.id, badgeKey },
  });
}

async function syncAchievements(firebaseUid, badgeKeys) {
  const user = await prisma.user.findUnique({ where: { firebaseUid } });
  if (!user) throw new Error("User not found");

  const existing = await prisma.achievement.findMany({
    where: { userId: user.id },
    select: { badgeKey: true },
  });

  const existingKeys = new Set(existing.map((a) => a.badgeKey));
  const newKeys = badgeKeys.filter((k) => !existingKeys.has(k));

  if (newKeys.length === 0) {
    return { created: 0, total: existing.length };
  }

  await prisma.achievement.createMany({
    data: newKeys.map((badgeKey) => ({ userId: user.id, badgeKey })),
    skipDuplicates: true,
  });

  return { created: newKeys.length, total: existing.length + newKeys.length };
}

module.exports = { getAchievements, unlockAchievement, syncAchievements };
