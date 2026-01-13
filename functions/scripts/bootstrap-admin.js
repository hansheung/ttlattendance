const admin = require("firebase-admin");
const crypto = require("crypto");

const path = require("path");
const serviceAccount = require(path.join(__dirname, "serviceAccount.json"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const USER_ID_PATTERN = /^[a-z0-9]{4,20}$/i;

const normalizeUserId = (value) => String(value ?? "").trim().toLowerCase();

const isValidUserId = (value) => USER_ID_PATTERN.test(String(value ?? "").trim());

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(password, salt, 64);
  return { hash: hash.toString("hex"), salt };
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  args.forEach((arg) => {
    const [key, value] = arg.split("=");
    if (key && key.startsWith("--")) {
      result[key.slice(2)] = value ?? "";
    }
  });
  return result;
};

const usage = () => {
  console.log("Usage:");
  console.log(
    "  node scripts/bootstrap-admin.js --userId=admin01 --name=\"Admin\" --password=\"secret\" --phone=\"\"",
  );
};

const main = async () => {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const rawUserId = String(args.userId ?? "").trim();
  const name = String(args.name ?? "").trim();
  const password = String(args.password ?? "");
  const phone = String(args.phone ?? "").trim();
  const userId = normalizeUserId(rawUserId);

  if (!rawUserId || !isValidUserId(rawUserId)) {
    console.error("User ID must be 4-20 letters or numbers.");
    usage();
    process.exit(1);
  }
  if (!name) {
    console.error("Name is required.");
    usage();
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error("Password must be at least 6 characters.");
    usage();
    process.exit(1);
  }

  const userDocRef = admin.firestore().doc(`users/${userId}`);
  const existing = await userDocRef.get();
  if (existing.exists) {
    console.error("User ID already exists.");
    process.exit(1);
  }

  try {
    await admin.auth().getUser(userId);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      await admin.auth().createUser({
        uid: userId,
        displayName: name,
      });
    } else {
      throw err;
    }
  }

  const { hash, salt } = hashPassword(password);
  await userDocRef.set({
    userId,
    name,
    phone: phone || null,
    normalRate: 0,
    otRate: 0,
    isAdmin: true,
    isDeleted: false,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLoginAt: null,
  });

  console.log(`Admin ${userId} created.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
