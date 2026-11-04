const { prisma } = require("../../config/database");
const { findOwnPlan, checkOwnPlan } = require("./shared");

/* The plain plan actions: no AI, no changes to the plan itself. */

/** The user's plans, newest first, without the plans themselves (the list doesn't show them). */
function listPlans(userId) {
  return prisma.plan.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, omit: { planData: true } });
}

const getPlan = findOwnPlan;

async function renamePlan(userId, planId, name) {
  await checkOwnPlan(userId, planId);
  return prisma.plan.update({ where: { id: planId }, data: { name } });
}

/** Makes this the active plan; the others become inactive. */
async function activatePlan(userId, planId) {
  await checkOwnPlan(userId, planId);
  return prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
    return tx.plan.update({ where: { id: planId }, data: { isActive: true } });
  });
}

/** If the deleted plan was active, the newest remaining plan takes over. */
async function deletePlan(userId, planId) {
  const plan = await checkOwnPlan(userId, planId);
  await prisma.$transaction(async (tx) => {
    await tx.plan.delete({ where: { id: planId } });
    if (!plan.isActive) return;
    const newest = await tx.plan.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    if (newest) await tx.plan.update({ where: { id: newest.id }, data: { isActive: true } });
  });
}

module.exports = { listPlans, getPlan, renamePlan, activatePlan, deletePlan };
