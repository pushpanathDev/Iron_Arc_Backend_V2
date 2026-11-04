/*
 * The shapes the AI must reply in. A reply that doesn't match is treated like
 * no reply at all (retried or reported as unavailable), never half-used.
 * Numbers may arrive as text ("3"); the plan validator parses and bounds them.
 */
const { z } = require("zod");

const looseNumber = z.union([z.number(), z.string()]).optional();

/** A day in the coach's short-key week format. */
const shortDay = z.object({
  d: z.string().max(20),
  t: z.string().max(20).optional(),
  m: z.array(z.string().max(30)).max(12).optional(),
  min: looseNumber,
  x: z
    .array(
      z.object({
        id: z.string().max(60),
        n: z.string().max(80).optional(),
        s: looseNumber,
        r: z.union([z.string().max(40), z.number()]).optional(),
        rest: looseNumber,
      }),
    )
    .max(12)
    .optional(),
});

/** Coach chat and "next week": a message, and the whole changed week or null. */
const weekChangeReply = z.object({
  message: z.string().min(1).max(4000),
  modifiedDays: z.array(shortDay).max(7).nullable().optional(),
});

/** Week 1 of a new plan: exercises for each training day. */
const firstWeekReply = z.object({
  planExplanation: z.string().max(4000).optional(),
  days: z
    .array(
      z.object({
        day: z.string().max(20),
        exercises: z
          .array(
            z.object({
              exerciseId: z.string().max(60),
              name: z.string().max(80).optional(),
              sets: looseNumber,
              reps: z.union([z.string().max(40), z.number()]).optional(),
              restSeconds: looseNumber,
              progressionNote: z.string().max(1000).optional(),
            }),
          )
          .max(12),
      }),
    )
    .max(7),
});

const substituteReply = z.object({
  substituteExerciseId: z.string().max(60),
  reason: z.string().max(1000).optional(),
});

/** The reply in `schema`'s shape, or null when it doesn't fit. */
function parseReply(schema, reply) {
  const result = schema.safeParse(reply);
  return result.success ? result.data : null;
}

module.exports = { weekChangeReply, firstWeekReply, substituteReply, parseReply };
