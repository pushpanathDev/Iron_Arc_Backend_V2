const express = require("express");
const router = express.Router();
const { prisma } = require("../config/database");

router.get("/", async (req, res) => {
  let dbStatus = "unknown";

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000)
    );
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutPromise]);
    dbStatus = "connected";
  } catch {
    dbStatus = "disconnected";
  }

  res.status(200).json({
    success: true,
    app: "Iron Arc Backend",
    version: "2.0.0",
    status: "healthy",
    database: dbStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

module.exports = router;
