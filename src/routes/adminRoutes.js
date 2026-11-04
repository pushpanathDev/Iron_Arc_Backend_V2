const express = require("express");
const { verifyAdminKey } = require("../middleware/adminMiddleware");
const { listUsers, disableUser } = require("../services/adminService");
const { deleteUserEverywhere } = require("../services/userService");
const { listReports, markReviewed, feedbackSummary } = require("../services/aiReportService");
const { resetSubscription, sendTrialReminders } = require("../services/billingService");

// Server-to-server only: every route needs the x-admin-key header.
// :uid is the user's Firebase UID.
const router = express.Router();
router.use(verifyAdminKey);

// Removes a user completely: their Firebase sign-in and all their data.
// 207 when one of the two failed; `data.errors` says which.
router.delete("/user/:uid", async (req, res) => {
  const result = await deleteUserEverywhere(req.params.uid);
  if (!(result.postgresDeleted && result.authDeleted)) {
    return res.status(207).json({ success: false, message: "Partial deletion. Review errors for remaining data.", data: result });
  }
  res.json({ success: true, message: "Iron Arc user completely deleted.", data: result });
});

// ?maxResults= (up to 100) &pageToken= from the previous page.
router.get("/users", async (req, res) => {
  const maxResults = Math.min(parseInt(req.query.maxResults) || 50, 100);
  const result = await listUsers(maxResults, req.query.pageToken || undefined);
  res.json({ success: true, data: result });
});

// Blocks sign-in and API access but keeps the data.
router.post("/user/:uid/disable", async (req, res) => {
  await disableUser(req.params.uid);
  res.json({ success: true, message: "User disabled." });
});

// Coach messages users reported from the app. ?status=open (default) or reviewed.
router.get("/ai-reports", async (req, res) => {
  const status = req.query.status === "reviewed" ? "reviewed" : "open";
  res.json({ success: true, data: await listReports(status) });
});

router.post("/ai-reports/:id/reviewed", async (req, res) => {
  await markReviewed(req.params.id);
  res.json({ success: true, message: "Report marked reviewed." });
});

// Thumbs up/down on coach replies over the last ?days= (default 30, up to 365), with recent "down" replies to review.
router.get("/ai-feedback", async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
  res.json({ success: true, data: await feedbackSummary(days) });
});

// Testing Iron Arc Pro: removes the user's subscription and receipts, so they can try the free trial again.
router.post("/user/:uid/subscription/reset", async (req, res) => {
  res.json({ success: true, message: "Subscription reset.", data: await resetSubscription(req.params.uid) });
});

// The daily job (.github/workflows/daily-jobs.yml): "your trial ends soon" emails, each sent once.
router.post("/jobs/trial-reminders", async (req, res) => {
  res.json({ success: true, data: await sendTrialReminders() });
});

module.exports = router;
