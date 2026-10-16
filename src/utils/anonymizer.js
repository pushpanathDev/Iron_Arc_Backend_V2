/**
 * The only profile fields the AI may see: training facts, never anything that
 * identifies the person (name, email, ids, avatar). Height and weight can be
 * empty; the prompts say "not provided".
 */
function anonymizeIronArcProfile(userProfile) {
  return {
    age: userProfile.age ?? null,
    height: userProfile.height ?? null,       // nullable — handle in prompt
    weight: userProfile.weight ?? null,       // nullable — handle in prompt
    fitnessGoal: userProfile.fitnessGoal ?? "general",
    weeklyGoal: userProfile.weeklyGoal ?? 3,
    experienceLevel: userProfile.experienceLevel ?? null,
    equipment: userProfile.equipment ?? null,
    sessionMinutes: userProfile.sessionMinutes ?? null,
    trainingDays: Array.isArray(userProfile.trainingDays) ? userProfile.trainingDays : [],
    avoidAreas: Array.isArray(userProfile.avoidAreas) ? userProfile.avoidAreas : [],
  };
}

module.exports = { anonymizeIronArcProfile };
