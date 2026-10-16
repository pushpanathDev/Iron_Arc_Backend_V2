require("dotenv").config();
const { validateRequiredEnv } = require("./config/env");

validateRequiredEnv();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { errorHandler } = require("./middleware/errorHandler");
const { adminLimiter } = require("./middleware/rateLimiter");

const healthRoutes = require("./routes/healthRoutes");
const planRoutes = require("./routes/planRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const workoutRoutes = require("./routes/workoutRoutes");
const bodyWeightRoutes = require("./routes/bodyWeightRoutes");
const customExerciseRoutes = require("./routes/customExerciseRoutes");
const achievementRoutes = require("./routes/achievementRoutes");

const app = express();

// Render terminates TLS at one proxy hop; trust it so req.ip is the client IP.
app.set("trust proxy", 1);

// ── Security Headers ───────────────────────────────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["*"];

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
    credentials: true,
    maxAge: 86400,
  })
);

// ── Body Parsing ───────────────────────────────────────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

// ── Routes ─────────────────────────────────────────────────────────────
app.use("/api/health", healthRoutes);
app.use("/api/user", userRoutes);
app.use("/api/workouts", workoutRoutes);
app.use("/api/weights", bodyWeightRoutes);
app.use("/api/exercises", customExerciseRoutes);
app.use("/api/achievements", achievementRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/admin", adminLimiter, adminRoutes);

// ── 404 Catch-All ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── Global Error Handler ───────────────────────────────────────────────
app.use(errorHandler);

// ── Start Server ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `✅ Iron Arc Backend running on port ${PORT} [${process.env.NODE_ENV}]`
  );
});

// ── Graceful Shutdown ──────────────────────────────────────────────────
const { prisma } = require("./config/database");

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = app;
