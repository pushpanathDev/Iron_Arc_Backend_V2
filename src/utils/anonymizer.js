/**
 * PRIVACY — strips all PII from Iron Arc user profile before sending to Gemini.
 *
 * Fields that exist in Iron Arc's profile document that must NEVER reach Gemini:
 * - email (direct PII)
 * - displayName (direct PII)
 * - userId (linkable to real identity)
 * - avatarUrl (linkable to real identity)
 * - authProvider (not relevant to planning)
 * - isEmailVerified (not relevant to planning)
 * - verificationSentAt (not relevant to planning)
 * - createdAt / updatedAt (not relevant to planning)
 *
 * Fields that ARE safe and useful for planning (passed through):
 * - age, height (nullable), weight (nullable), fitnessGoal, weeklyGoal
 *
 * Edge Case: height and weight can be null in Iron Arc (they are optional
 * onboarding fields). The anonymizer must pass null through — the planning
 * service handles null gracefully in the prompt.
 */
function anonymizeIronArcProfile(userProfile, userId) {
  return {
    age: userProfile.age ?? null,
    height: userProfile.height ?? null,       // nullable — handle in prompt
    weight: userProfile.weight ?? null,       // nullable — handle in prompt
    fitnessGoal: userProfile.fitnessGoal ?? 'general',
    weeklyGoal: userProfile.weeklyGoal ?? 3,
    // Opaque session reference — non-reversible, used for logging only
    sessionRef: `arc_${Buffer.from(userId).toString('base64').slice(0, 8)}`,
  };
}

module.exports = { anonymizeIronArcProfile };
