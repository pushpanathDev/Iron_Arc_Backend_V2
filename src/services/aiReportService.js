const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { chatOf } = require("../utils/planChat");
const { aiText } = require("../utils/aiText");

/*
 * What users tell us about the coach's replies, from the app:
 * - reports (Google Play requires apps with AI chat to let users report its
 *   replies without leaving the app), reviewed by an admin;
 * - thumbs up or down, which show how the coach does with real users (the
 *   admin summary), and whose "down" replies are candidates for the eval set
 *   (evals/coachCases.js).
 * Each keeps a copy of the reply, since the chat can change or the plan be
 * deleted; the chat entry is marked so the app shows it.
 */

/** The coach reply in the user's own plan, by its timestamp, or a 404. */
async function findCoachReply(user, planId, messageAt) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId: user.id } });
  if (!plan) throw new HttpError(404, "Plan not found.");
  const history = chatOf(plan.planData);
  const entry = history.find((m) => m.role === "assistant" && m.timestamp === messageAt);
  if (!entry) throw new HttpError(404, "That message wasn't found in this chat.");
  return { plan, history, entry };
}

/**
 * Saves the chat with the reply's entry changed by `mark`. Best-effort: what
 * the user sent is saved either way, and a plan that changed meanwhile simply
 * shows the mark after the next refresh.
 */
async function markReply({ plan, history, entry }, mark) {
  const marked = history.map((m) => (m === entry ? mark(m) : m));
  const planData = { ...plan.planData, _chatHistory: marked };
  await prisma.plan.updateMany({ where: { id: plan.id, updatedAt: plan.updatedAt }, data: { planData } });
  return { chatHistory: marked, planData };
}

const copyOf = (entry) => aiText(entry.content, 2000) || "(empty)";

/**
 * Reports one of the coach's messages in the user's own plan. Reporting the
 * same message again is fine (the first report stands).
 */
async function reportCoachMessage(user, planId, { messageAt, reason, note }) {
  const found = await findCoachReply(user, planId, messageAt);
  try {
    await prisma.aiReport.create({
      data: { userId: user.id, planId, messageAt, content: copyOf(found.entry), reason, note: note || null },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error; // already reported
  }
  return markReply(found, (m) => ({ ...m, reported: true }));
}

/** A thumbs up or down on a coach reply; null takes it back. Changing it replaces the old one. */
async function rateCoachMessage(user, planId, { messageAt, rating }) {
  const found = await findCoachReply(user, planId, messageAt);
  const key = { userId_planId_messageAt: { userId: user.id, planId, messageAt } };
  if (rating) {
    await prisma.aiFeedback.upsert({
      where: key,
      create: { userId: user.id, planId, messageAt, content: copyOf(found.entry), kind: found.entry.kind ?? "chat", rating },
      update: { rating },
    });
  } else {
    await prisma.aiFeedback.deleteMany({ where: { userId: user.id, planId, messageAt } });
  }
  // Taken back: undefined, so the saved JSON leaves the field out.
  return markReply(found, (m) => ({ ...m, feedback: rating ?? undefined }));
}

/** Newest first: reports with the given status (default open), at most 100. */
function listReports(status = "open") {
  return prisma.aiReport.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100 });
}

async function markReviewed(id) {
  const { count } = await prisma.aiReport.updateMany({ where: { id }, data: { status: "reviewed" } });
  if (count === 0) throw new HttpError(404, "Report not found.");
}

/**
 * How the coach did over the last `days`: thumbs up and down, the share that
 * were up, and the latest "down" replies (with no user ids) to review.
 */
async function feedbackSummary(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [counts, recentDown] = await Promise.all([
    prisma.aiFeedback.groupBy({ by: ["rating"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.aiFeedback.findMany({
      where: { rating: "down", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { content: true, kind: true, createdAt: true },
    }),
  ]);
  const count = (rating) => counts.find((c) => c.rating === rating)?._count._all ?? 0;
  const up = count("up");
  const down = count("down");
  return { days, up, down, upShare: up + down > 0 ? Math.round((up / (up + down)) * 100) / 100 : null, recentDown };
}

module.exports = { reportCoachMessage, rateCoachMessage, listReports, markReviewed, feedbackSummary };
