const { z } = require("zod");

const workoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  exercise: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  notes: z.string().max(500).optional().nullable(),
  sets: z
    .array(
      z.object({
        reps: z.number().int().min(0).max(9999),
        weight: z.number().min(0).max(9999).optional().default(0),
      })
    )
    .min(1)
    .max(50),
});

// POST /api/workouts/batch: one session = several workouts on one date.
// Each entry is the single-create shape; its own date is optional and, if
// given, must equal the batch date.
const MAX_BATCH_ENTRIES = 30;
const workoutBatchSchema = z
  .object({
    date: workoutSchema.shape.date,
    entries: z
      .array(workoutSchema.extend({ date: workoutSchema.shape.date.optional() }))
      .min(1)
      .max(MAX_BATCH_ENTRIES),
  })
  .superRefine((body, ctx) => {
    body.entries.forEach((entry, i) => {
      if (entry.date && entry.date !== body.date) {
        ctx.addIssue({ code: "custom", path: ["entries", i, "date"], message: "entry date must match the batch date" });
      }
    });
  });

const workoutUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  exercise: z.string().min(1).max(100).optional(),
  category: z.string().min(1).max(50).optional(),
  notes: z.string().max(500).optional().nullable(),
  sets: z
    .array(
      z.object({
        reps: z.number().int().min(0).max(9999),
        weight: z.number().min(0).max(9999).optional().default(0),
      })
    )
    .min(1)
    .max(50)
    .optional(),
});

const bodyWeightSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  weight: z.number().min(1).max(500),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  authProvider: z.string().max(50).nullable().optional(),
  height: z.number().min(50).max(300).optional().nullable(),
  weight: z.number().min(1).max(500).optional().nullable(),
  age: z.number().int().min(10).max(120).optional().nullable(),
  fitnessGoal: z.string().max(200).optional().nullable(),
  weeklyGoal: z.number().int().min(1).max(7).optional(),
});

const customExerciseSchema = z.object({
  category: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
});

const substituteSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  reason: z.string().max(200).optional().default("user_request"),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      // Never log req.body: it carries personal data (weight, age, notes).
      console.warn("[validation] Rejected request", {
        path: req.path,
        method: req.method,
        errors,
      });
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  validate,
  workoutSchema,
  workoutBatchSchema,
  workoutUpdateSchema,
  bodyWeightSchema,
  profileUpdateSchema,
  customExerciseSchema,
  substituteSchema,
};
