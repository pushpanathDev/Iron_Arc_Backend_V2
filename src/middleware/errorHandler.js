function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    console.error(`[Error] ${req.method} ${req.path} — ${err.message}`);
    console.error(err.stack);
  } else {
    console.error(`[Error] ${req.method} ${req.path} — ${err.message}`);
  }

  // Prisma known errors
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "A record with this data already exists.",
    });
  }

  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      message: "Record not found.",
    });
  }

  // Groq / AI errors
  if (
    err.message?.includes("Groq") ||
    err.message?.includes("GROQ")
  ) {
    return res.status(503).json({
      success: false,
      message: "AI service temporarily unavailable. Please try again.",
    });
  }

  // Firebase Auth errors
  if (err.code?.startsWith("auth/")) {
    return res.status(500).json({
      success: false,
      message: "Authentication service error. Please try again.",
    });
  }

  // Generic fallback
  res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : "Something went wrong. Please try again.",
  });
}

module.exports = { errorHandler };
