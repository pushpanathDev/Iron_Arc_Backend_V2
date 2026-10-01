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
      console.warn("[validation] Rejected request", {
        path: req.path,
        method: req.method,
        body: req.body,
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
  workoutUpdateSchema,
  bodyWeightSchema,
  profileUpdateSchema,
  customExerciseSchema,
  substituteSchema,
};
