require("dotenv").config();

const { auth, db } = require("../src/config/firebase");
const { prisma } = require("../src/config/database");

const USER_PAGE_SIZE = 1000;
const USER_DELAY_MS = 100;

const summary = {
  usersProcessed: 0,
  workoutsMigrated: 0,
  weightsMigrated: 0,
  achievementsMigrated: 0,
  customExercisesMigrated: 0,
  errors: [],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    const milliseconds = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number") {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = new Date(`${trimmed}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function toDateOnly(value) {
  const parsed = toDate(value);
  if (!parsed) return null;

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate()
  ));
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = toNumber(value);
  return number === null ? null : Math.trunc(number);
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue ? stringValue : null;
}

function fallbackEmail(firebaseUser, profileData) {
  return (
    toStringOrNull(profileData?.email) ||
    toStringOrNull(firebaseUser.email) ||
    `${firebaseUser.uid}@imported.firebase.local`
  );
}

function fallbackDisplayName(firebaseUser, profileData) {
  return (
    toStringOrNull(profileData?.displayName) ||
    toStringOrNull(firebaseUser.displayName) ||
    null
  );
}

function fallbackAvatarUrl(firebaseUser, profileData) {
  return (
    toStringOrNull(profileData?.avatarUrl) ||
    toStringOrNull(firebaseUser.photoURL) ||
    null
  );
}

function fallbackAuthProvider(firebaseUser, profileData) {
  return (
    toStringOrNull(profileData?.authProvider) ||
    toStringOrNull(firebaseUser.providerData?.[0]?.providerId) ||
    null
  );
}

function creationDate(firebaseUser, profileData) {
  return (
    toDate(profileData?.createdAt) ||
    toDate(firebaseUser.metadata?.creationTime) ||
    new Date()
  );
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function recordError(message) {
  summary.errors.push(message);
  console.error(`❌ ${message}`);
}

async function getCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  return snapshot.docs;
}

async function migrateUserProfile(firebaseUser) {
  const profileRef = db.collection("users").doc(firebaseUser.uid).collection("profile").doc("data");
  const profileSnap = await profileRef.get();
  const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
  const createdAt = creationDate(firebaseUser, profileData);

  const userData = {
    firebaseUid: firebaseUser.uid,
    email: fallbackEmail(firebaseUser, profileData),
    displayName: fallbackDisplayName(firebaseUser, profileData),
    avatarUrl: fallbackAvatarUrl(firebaseUser, profileData),
    authProvider: fallbackAuthProvider(firebaseUser, profileData),
    height: toNumber(profileData.height),
    weight: toNumber(profileData.weight),
    age: toInteger(profileData.age),
    fitnessGoal: toStringOrNull(profileData.fitnessGoal),
    weeklyGoal: toInteger(profileData.weeklyGoal) ?? 4,
    isAdmin: Boolean(profileData.isAdmin),
    isActive: profileData.isActive === undefined ? true : Boolean(profileData.isActive),
    createdAt,
  };

  const upsertedUser = await prisma.user.upsert({
    where: { firebaseUid: firebaseUser.uid },
    create: userData,
    update: {
      email: userData.email,
      displayName: userData.displayName,
      avatarUrl: userData.avatarUrl,
      authProvider: userData.authProvider,
      height: userData.height,
      weight: userData.weight,
      age: userData.age,
      fitnessGoal: userData.fitnessGoal,
      weeklyGoal: userData.weeklyGoal,
      isAdmin: userData.isAdmin,
      isActive: userData.isActive,
    },
  });

  return upsertedUser;
}

async function migrateWorkouts(firebaseUser, userId) {
  let migrated = 0;

  try {
    const docs = await getCollectionDocs(
      db.collection("users").doc(firebaseUser.uid).collection("workouts")
    );

    for (const docSnap of docs) {
      const data = docSnap.data() || {};
      const workoutDate = toDateOnly(data.date);
      const exercise = toStringOrNull(data.exercise);

      if (!workoutDate || !exercise) {
        console.warn(`⚠️ Skipped workout ${docSnap.id}: missing or invalid date/exercise`);
        continue;
      }

      const sets = Array.isArray(data.sets)
        ? data.sets
            .map((set, index) => ({
              setNumber: toInteger(set?.setNumber) ?? index + 1,
              reps: toInteger(set?.reps),
              weight: toNumber(set?.weight) ?? 0,
            }))
            .filter((set) => Number.isInteger(set.setNumber) && Number.isInteger(set.reps))
            .sort((left, right) => left.setNumber - right.setNumber)
        : [];

      await prisma.workout.upsert({
        where: { id: docSnap.id },
        create: {
          id: docSnap.id,
          userId,
          date: workoutDate,
          exercise,
          category: toStringOrNull(data.category) || "uncategorized",
          notes: toStringOrNull(data.notes),
          deletedAt: toDate(data.deletedAt),
          createdAt: toDate(data.createdAt) || new Date(),
          sets: {
            create: sets,
          },
        },
        update: {
          userId,
          date: workoutDate,
          exercise,
          category: toStringOrNull(data.category) || "uncategorized",
          notes: toStringOrNull(data.notes),
          deletedAt: toDate(data.deletedAt),
          sets: {
            deleteMany: {},
            create: sets,
          },
        },
      });

      migrated += 1;
    }
  } catch (error) {
    recordError(`Error migrating workouts for user ${firebaseUser.uid}: ${normalizeError(error)}`);
  }

  return migrated;
}

async function migrateBodyWeights(firebaseUser, userId) {
  let migrated = 0;

  try {
    const docs = await getCollectionDocs(
      db.collection("users").doc(firebaseUser.uid).collection("weights")
    );

    for (const docSnap of docs) {
      const data = docSnap.data() || {};
      const weight = toNumber(data.weight);
      const date = toDateOnly(data.date);

      if (weight === null || !date) {
        console.warn(`⚠️ Skipped weight ${docSnap.id}: missing or invalid date/weight`);
        continue;
      }

      await prisma.bodyWeight.upsert({
        where: {
          userId_date: {
            userId,
            date,
          },
        },
        create: {
          id: docSnap.id,
          userId,
          date,
          weekStart: toDateOnly(data.weekStart),
          weight,
          deletedAt: toDate(data.deletedAt),
          createdAt: toDate(data.createdAt) || new Date(),
        },
        update: {
          weight,
          weekStart: toDateOnly(data.weekStart),
          deletedAt: toDate(data.deletedAt),
        },
      });

      migrated += 1;
    }
  } catch (error) {
    recordError(`Error migrating weights for user ${firebaseUser.uid}: ${normalizeError(error)}`);
  }

  return migrated;
}

async function migrateAchievements(firebaseUser, userId) {
  let migrated = 0;

  try {
    const docs = await getCollectionDocs(
      db.collection("users").doc(firebaseUser.uid).collection("achievements")
    );

    for (const docSnap of docs) {
      const badgeKey = toStringOrNull(docSnap.id);
      if (!badgeKey) {
        console.warn(`⚠️ Skipped achievement ${docSnap.id}: missing badge key`);
        continue;
      }

      const data = docSnap.data() || {};
      const unlockedAt = toDate(data.unlockedAt) || new Date();

      await prisma.achievement.upsert({
        where: {
          userId_badgeKey: {
            userId,
            badgeKey,
          },
        },
        create: {
          userId,
          badgeKey,
          unlockedAt,
        },
        update: {
          unlockedAt,
        },
      });

      migrated += 1;
    }
  } catch (error) {
    recordError(`Error migrating achievements for user ${firebaseUser.uid}: ${normalizeError(error)}`);
  }

  return migrated;
}

async function migrateCustomExercises(firebaseUser, userId) {
  let migrated = 0;

  try {
    const docs = await getCollectionDocs(
      db.collection("users").doc(firebaseUser.uid).collection("customExercises")
    );

    for (const docSnap of docs) {
      const data = docSnap.data() || {};
      const category = toStringOrNull(data.category);
      const name = toStringOrNull(data.name);

      if (!category || !name) {
        console.warn(`⚠️ Skipped custom exercise ${docSnap.id}: missing category/name`);
        continue;
      }

      await prisma.customExercise.upsert({
        where: {
          userId_category_name: {
            userId,
            category,
            name,
          },
        },
        create: {
          id: docSnap.id,
          userId,
          category,
          name,
          createdAt: toDate(data.createdAt) || new Date(),
        },
        update: {
          category,
          name,
        },
      });

      migrated += 1;
    }
  } catch (error) {
    recordError(`Error migrating custom exercises for user ${firebaseUser.uid}: ${normalizeError(error)}`);
  }

  return migrated;
}

async function migrateUsers() {
  const users = [];
  let pageToken = undefined;

  while (true) {
    const page = await auth.listUsers(USER_PAGE_SIZE, pageToken);
    users.push(...page.users);

    if (!page.pageToken) {
      break;
    }

    pageToken = page.pageToken;
  }

  for (const firebaseUser of users) {
    try {
      const userRecord = await migrateUserProfile(firebaseUser);

      const [workouts, weights, achievements, customExercises] = await Promise.all([
        migrateWorkouts(firebaseUser, userRecord.id),
        migrateBodyWeights(firebaseUser, userRecord.id),
        migrateAchievements(firebaseUser, userRecord.id),
        migrateCustomExercises(firebaseUser, userRecord.id),
      ]);

      summary.usersProcessed += 1;
      summary.workoutsMigrated += workouts;
      summary.weightsMigrated += weights;
      summary.achievementsMigrated += achievements;
      summary.customExercisesMigrated += customExercises;

      console.log(`✅ Migrated user ${firebaseUser.email || userRecord.email} (${firebaseUser.uid})`);
    } catch (error) {
      recordError(`Error migrating user ${firebaseUser.uid}: ${normalizeError(error)}`);
    }

    await sleep(USER_DELAY_MS);
  }
}

async function main() {
  try {
    await migrateUsers();
  } catch (error) {
    recordError(`Fatal migration error: ${normalizeError(error)}`);
  } finally {
    console.log("=== MIGRATION COMPLETE ===");
    console.log(`Users processed: ${summary.usersProcessed}`);
    console.log(`Workouts migrated: ${summary.workoutsMigrated}`);
    console.log(`Weights migrated: ${summary.weightsMigrated}`);
    console.log(`Achievements migrated: ${summary.achievementsMigrated}`);
    console.log(`Custom exercises migrated: ${summary.customExercisesMigrated}`);
    console.log(`Errors: ${summary.errors.length}`);

    if (summary.errors.length > 0) {
      console.log("--- ERRORS ---");
      for (const error of summary.errors) {
        console.log(error);
      }
    }

    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
