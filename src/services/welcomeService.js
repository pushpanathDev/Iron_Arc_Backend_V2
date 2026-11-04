const { prisma } = require("../config/database");
const { sendEmail } = require("./emailService");
const { proStatus } = require("./billingService");
const { welcomeEmail } = require("../emails/welcome");

/*
 * "Welcome to Iron Arc", once per account: when a profile save completes
 * onboarding (age, goal and training days set) on a verified email. The
 * account is marked first, so two saves at once can't send two; if sending
 * fails the mark is taken back and the next save tries again. Accounts that
 * existed before this email were marked by its migration.
 */

/** Onboarding is done: what the app asks before anything else. */
const onboarded = (user) => user.age != null && !!user.fitnessGoal && Array.isArray(user.trainingDays) && user.trainingDays.length > 0;

/** Sends the welcome if this account is ready for it and hasn't had it. Never throws. */
async function welcomeIfReady(user, { emailVerified }) {
  if (user.welcomedAt || !emailVerified || !onboarded(user)) return false;
  try {
    const claimed = await prisma.user.updateMany({ where: { id: user.id, welcomedAt: null }, data: { welcomedAt: new Date() } });
    if (claimed.count === 0) return false;
  } catch (error) {
    console.warn(`[welcome] Couldn't mark ${user.id}: ${error.message}`);
    return false;
  }
  try {
    const { pro } = await proStatus(user);
    await sendEmail({ to: user.email, ...welcomeEmail({ user, trialAvailable: pro.trialAvailable }), idempotencyKey: `welcome-${user.id}` });
    console.log(`[welcome] Sent to ${user.id}`);
    return true;
  } catch (error) {
    console.warn(`[welcome] Not sent to ${user.id}: ${error.message}`);
    await prisma.user.updateMany({ where: { id: user.id }, data: { welcomedAt: null } }).catch(() => {});
    return false;
  }
}

module.exports = { welcomeIfReady };
