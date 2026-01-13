const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const USER_ID_PATTERN = /^[a-z0-9]{4,20}$/i;

const normalizeUserId = (value) => String(value ?? "").trim().toLowerCase();

const isValidUserId = (value) => USER_ID_PATTERN.test(String(value ?? "").trim());

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(password, salt, 64);
  return { hash: hash.toString("hex"), salt };
};

const verifyPassword = (password, hashHex, salt) => {
  const stored = Buffer.from(hashHex, "hex");
  const computed = crypto.scryptSync(password, salt, stored.length);
  return crypto.timingSafeEqual(stored, computed);
};

const assertAdmin = async (context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Sign in required.",
    );
  }
  const adminDoc = await admin
    .firestore()
    .doc(`users/${context.auth.uid}`)
    .get();
  if (!adminDoc.exists || adminDoc.data()?.isAdmin !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required.",
    );
  }
};

exports.loginWithUserId = functions.https.onCall(async (data) => {
  const rawUserId = String(data?.userId ?? "").trim();
  const password = String(data?.password ?? "");
  const userId = normalizeUserId(rawUserId);

  if (!rawUserId || !isValidUserId(rawUserId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User ID must be 4-20 letters or numbers.",
    );
  }
  if (!password || password.length < 6) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters.",
    );
  }

  const docRef = admin.firestore().doc(`users/${userId}`);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "User not found.",
    );
  }

  const dataDoc = snapshot.data() || {};
  if (dataDoc.isDeleted) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Account is disabled.",
    );
  }

  const passwordHash = String(dataDoc.passwordHash ?? "");
  const passwordSalt = String(dataDoc.passwordSalt ?? "");
  if (!passwordHash || !passwordSalt) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Password not set.",
    );
  }

  const ok = verifyPassword(password, passwordHash, passwordSalt);
  if (!ok) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Invalid credentials.",
    );
  }

  try {
    await admin.auth().getUser(userId);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      await admin.auth().createUser({
        uid: userId,
        displayName: dataDoc.name || undefined,
      });
    } else {
      throw err;
    }
  }

  await docRef.set(
    { lastLoginAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );

  const token = await admin.auth().createCustomToken(userId);
  return { token, isAdmin: dataDoc.isAdmin === true };
});

exports.adminCreateUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const rawUserId = String(data?.userId ?? "").trim();
  const userId = normalizeUserId(rawUserId);
  const name = String(data?.name ?? "").trim();
  const phone = String(data?.phone ?? "").trim();
  const passport = String(data?.passport ?? "").trim();
  const password = String(data?.password ?? "");
  const normalRate = Number(data?.normalRate ?? 0);
  const otRate = Number(data?.otRate ?? 0);

  if (!rawUserId || !isValidUserId(rawUserId)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User ID must be 4-20 letters or numbers.",
    );
  }
  if (!name) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Name is required.",
    );
  }
  if (!password || password.length < 6) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters.",
    );
  }
  if (
    Number.isNaN(normalRate) ||
    Number.isNaN(otRate) ||
    normalRate < 0 ||
    otRate < 0
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Rates must be valid numbers.",
    );
  }

  const userDocRef = admin.firestore().doc(`users/${userId}`);
  const existing = await userDocRef.get();
  if (existing.exists) {
    throw new functions.https.HttpsError(
      "already-exists",
      "User ID already exists.",
    );
  }

  try {
    await admin.auth().createUser({
      uid: userId,
      displayName: name,
    });
  } catch (err) {
    if (err && err.code === "auth/uid-already-exists") {
      throw new functions.https.HttpsError(
        "already-exists",
        "User ID already exists.",
      );
    }
    throw new functions.https.HttpsError("internal", "Unable to create user.");
  }

  const { hash, salt } = hashPassword(password);
  await userDocRef.set(
    {
      userId,
      name,
      phone: phone || null,
      passport: passport || null,
      normalRate,
      otRate,
      isAdmin: false,
      isDeleted: false,
      passwordHash: hash,
      passwordSalt: salt,
      displayPassword: password,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null,
    },
    { merge: true },
  );

  return { uid: userId };
});

exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = String(data?.uid ?? "").trim();
  if (!uid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User id is required.",
    );
  }
  if (context.auth?.uid === uid) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "You cannot delete your own account.",
    );
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (!(err && err.code === "auth/user-not-found")) {
      throw err;
    }
  }
  await admin.firestore().doc(`users/${uid}`).set(
    {
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});

exports.adminSetUserPassword = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = normalizeUserId(data?.uid ?? "");
  const password = String(data?.password ?? "");
  if (!uid || !isValidUserId(uid)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User ID is required.",
    );
  }
  if (!password || password.length < 6) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters.",
    );
  }

  const docRef = admin.firestore().doc(`users/${uid}`);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "User not found.",
    );
  }

  const { hash, salt } = hashPassword(password);
  const dataDoc = snapshot.data() || {};
  const isAdmin = dataDoc.isAdmin === true;
  await docRef.set(
    {
      passwordHash: hash,
      passwordSalt: salt,
      displayPassword: isAdmin ? admin.firestore.FieldValue.delete() : password,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});
