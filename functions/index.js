const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

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

exports.adminCreateUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const name = String(data?.name ?? "").trim();
  const email = String(data?.email ?? "").trim().toLowerCase();
  const position = String(data?.position ?? "").trim();
  const employeeId = String(data?.employeeId ?? "").trim();
  const tempPassword = String(data?.tempPassword ?? "");
  const normalRate = Number(data?.normalRate ?? 0);
  const otRate = Number(data?.otRate ?? 0);

  if (!name || !email || !employeeId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Name, email, and employee ID are required.",
    );
  }
  if (!tempPassword || tempPassword.length < 6) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Temp password must be at least 6 characters.",
    );
  }
  if (Number.isNaN(normalRate) || Number.isNaN(otRate)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Rates must be valid numbers.",
    );
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: name,
    });
  } catch (err) {
    if (err && err.code === "auth/email-already-exists") {
      throw new functions.https.HttpsError(
        "already-exists",
        "Email already exists.",
      );
    }
    throw new functions.https.HttpsError("internal", "Unable to create user.");
  }

  await admin.firestore().doc(`users/${userRecord.uid}`).set(
    {
      name,
      email,
      position: position || null,
      employeeId,
      normalRate,
      otRate,
      isAdmin: false,
      isDeleted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null,
    },
    { merge: true },
  );

  return { uid: userRecord.uid };
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

  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`users/${uid}`).set(
    {
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});
