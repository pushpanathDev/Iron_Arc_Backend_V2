const { z } = require("zod");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// 1–50 sets; weight in kg, 0 for bodyweight.
const setsSchema = z
  .array(
    z.object({
      reps: z.number().int().min(0).max(9999),
      weight: z.number().min(0).max(9999).optional().default(0),
    })
  )
  .min(1)
  .max(50);

const workoutSchema = z.object({
  date: isoDate,
  exercise: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  notes: z.string().max(500).optional().nullable(),
  sets: setsSchema,
});

// POST /api/workouts/batch: one session = several workouts on one date.
// Each entry is the single-create shape; its own date is optional and, if
// given, must equal the batch date.
const MAX_BATCH_ENTRIES = 30;
const workoutBatchSchema = z
  .object({
    date: isoDate,
    entries: z
      .array(workoutSchema.extend({ date: isoDate.optional() }))
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

// Any subset of a workout; sets, when given, replace all of the old ones.
const workoutUpdateSchema = workoutSchema.partial();

const bodyWeightSchema = z.object({
  date: isoDate,
  weight: z.number().min(1).max(500),
  weekStart: isoDate.optional().nullable(),
});

const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  authProvider: z.string().max(50).nullable().optional(),
  height: z.number().min(50).max(300).optional().nullable(),
  age: z.number().int().min(10).max(120).optional().nullable(),
  fitnessGoal: z.string().max(200).optional().nullable(),
  weeklyGoal: z.number().int().min(1).max(7).optional(),
  // Target body weight in kg; null clears it. Same range the app allows for logging.
  targetWeight: z.number().min(20).max(500).nullable().optional(),
  // Training profile (onboarding). Fixed vocabularies so the plan prompt only sees known values.
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  equipment: z.enum(["full_gym", "dumbbells", "bodyweight"]).nullable().optional(),
  sessionMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).nullable().optional(),
  // ISO weekdays (1 = Mon … 7 = Sun), at most 6: one rest day minimum.
  trainingDays: z
    .array(z.number().int().min(1).max(7))
    .max(6)
    .refine((days) => new Set(days).size === days.length, "training days must not repeat")
    .optional(),
  avoidAreas: z.array(z.enum(["knees", "lower_back", "shoulders", "wrists"])).max(4).optional(),
});

const customExerciseSchema = z.object({
  category: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
});

const substituteSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  // The app sends "user_request" when the user gave no reason.
  reason: z.string().max(200).optional().transform((reason) => (reason && reason !== "user_request" ? reason : undefined)),
});

// Longer names are cut to 60 characters rather than rejected.
const renamePlanSchema = z.object({
  name: z.string().trim().min(1, "A non-empty name is required.").transform((name) => name.slice(0, 60)),
});

const planChatSchema = z.object({
  message: z.string().trim().min(1, "Message is required.").max(1000, "Message is too long (max 1000 characters)."),
  // The user's own date, so the coach knows where in the week they are. Older apps don't send it.
  today: isoDate.optional(),
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
  renamePlanSchema,
  planChatSchema,
};
