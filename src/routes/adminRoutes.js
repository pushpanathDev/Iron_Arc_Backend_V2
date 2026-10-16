const express = require("express");
const { verifyAdminKey } = require("../middleware/adminMiddleware");
const { deleteIronArcUser, listUsers, disableUser } = require("../services/adminService");

// Server-to-server only: every route needs the x-admin-key header.
// :uid is the user's Firebase UID.
const router = express.Router();
router.use(verifyAdminKey);

// Removes a user completely: their Firebase sign-in and all their data.
// 207 when one of the two failed; `data.errors` says which.
router.delete("/user/:uid", async (req, res) => {
  const result = await deleteIronArcUser(req.params.uid);
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

module.exports = router;
