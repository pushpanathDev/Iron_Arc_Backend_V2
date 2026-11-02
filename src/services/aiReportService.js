const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { chatOf } = require("../utils/planChat");
const { aiText } = require("../utils/aiText");

/*
 * Reports of coach messages, sent from the app (Google Play requires apps with
 * AI chat to let users report its replies without leaving the app). A report
 * keeps a copy of the message, since the chat can change or the plan be
 * deleted; the chat entry is marked so the app shows it as reported.
 */

/**
 * Reports one of the coach's messages in the user's own plan. Reporting the
 * same message again is fine (the first report stands).
 */
async function reportCoachMessage(user, planId, { messageAt, reason, note }) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId: user.id } });
  if (!plan) throw new HttpError(404, "Plan not found.");
  const history = chatOf(plan.planData);
  const entry = history.find((m) => m.role === "assistant" && m.timestamp === messageAt);
  if (!entry) throw new HttpError(404, "That message wasn't found in this chat.");

  try {
    await prisma.aiReport.create({
      data: { userId: user.id, planId, messageAt, content: aiText(entry.content, 2000) || "(empty)", reason, note: note || null },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error; // already reported
  }

  // Mark it in the chat. Best-effort: the report is saved either way, and a
  // plan that changed meanwhile simply shows the mark after the next refresh.
  const marked = history.map((m) => (m === entry ? { ...m, reported: true } : m));
  const planData = { ...plan.planData, _chatHistory: marked };
  await prisma.plan.updateMany({ where: { id: plan.id, updatedAt: plan.updatedAt }, data: { planData } });
  return { chatHistory: marked, planData };
}

/** Newest first: reports with the given status (default open), at most 100. */
function listReports(status = "open") {
  return prisma.aiReport.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100 });
}

/** Marks a report reviewed. */
async function markReviewed(id) {
  const { count } = await prisma.aiReport.updateMany({ where: { id }, data: { status: "reviewed" } });
  if (count === 0) throw new HttpError(404, "Report not found.");
}

module.exports = { reportCoachMessage, listReports, markReviewed };
