// ─────────────────────────────────────────────────────────────────────────────
// services/backendApi.js — Add this file to the Iron Arc React Native app
// ─────────────────────────────────────────────────────────────────────────────
// This file handles all communication between the Iron Arc React Native app
// and the Iron Arc Backend server. It uses the Firebase ID token from the
// existing Firebase Web SDK auth setup for authentication.
// ─────────────────────────────────────────────────────────────────────────────

import { getAuth } from 'firebase/auth';

// Switch this to your Render URL once deployed
const BASE_URL = __DEV__
  ? 'http://localhost:3000'
  : 'https://iron-arc-backend.onrender.com';

/**
 * Gets a fresh Firebase ID token for the current user.
 * getIdToken(true) forces a refresh if the token is about to expire.
 */
async function getIdToken() {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  return await user.getIdToken(true);
}

/**
 * Helper to make authenticated requests to the Iron Arc backend.
 */
async function authenticatedFetch(endpoint, options = {}) {
  const token = await getIdToken();

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  const data = await res.json();

  if (!data.success) {
    throw new Error(data.message || 'Request failed');
  }

  return data.data;
}

/**
 * Generate a new personalised workout plan.
 * Calls POST /api/plan/generate
 */
export async function generateWorkoutPlan() {
  return authenticatedFetch('/api/plan/generate', { method: 'POST' });
}

/**
 * Recalibrate the current active plan based on recent performance.
 * Calls POST /api/plan/recalibrate
 */
export async function recalibrateWeeklyPlan() {
  return authenticatedFetch('/api/plan/recalibrate', { method: 'POST' });
}

/**
 * Substitute a specific exercise in the plan.
 * Calls POST /api/plan/substitute
 *
 * @param {string} exerciseId — the exercise ID to replace
 * @param {string} reason — why the user wants a substitute (e.g. "injury", "no_equipment")
 */
export async function substituteExercise(exerciseId, reason) {
  return authenticatedFetch('/api/plan/substitute', {
    method: 'POST',
    body: JSON.stringify({ exerciseId, reason }),
  });
}

/**
 * Check if the backend server is healthy.
 * Calls GET /api/health (no auth required)
 */
export async function checkBackendHealth() {
  const res = await fetch(`${BASE_URL}/api/health`);
  return await res.json();
}
