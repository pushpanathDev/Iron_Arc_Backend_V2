const express = require("express");
const { prisma } = require("../config/database");
const { version } = require("../../package.json");

const DB_CHECK_MS = 3000;

const router = express.Router();

// Public, no sign-in: the app's startup check and the uptime pinger. Always
// 200 while the server runs; `database` says whether Postgres answered in time.
router.get("/", async (req, res) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), DB_CHECK_MS);
  });
  const database = await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]).then(
    () => "connected",
    () => "disconnected",
  );
  clearTimeout(timer);

  res.json({
    success: true,
    app: "Iron Arc Backend",
    version,
    status: "healthy",
    database,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
