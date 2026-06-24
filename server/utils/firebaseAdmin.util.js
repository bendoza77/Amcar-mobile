const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

/**
 * Firebase Admin — used only to verify the ID token the app obtains
 * after a successful Firebase phone-number sign-in. We never mint
 * Firebase sessions server-side; we just trust Google's signature on
 * the token, read the verified phone number, and issue our own JWT.
 *
 * The service-account credential is resolved in this order:
 *   1. FIREBASE_SERVICE_ACCOUNT — the JSON itself as a single-line string.
 *   2. GOOGLE_APPLICATION_CREDENTIALS — a path to the JSON file.
 *   3. ./firebase-service-account.json next to the server (the default;
 *      git-ignored). Resolved from __dirname so it works regardless of
 *      the process's working directory.
 */
const DEFAULT_KEY_PATH = path.join(__dirname, "..", "firebase-service-account.json");

const resolveKeyPath = () => {
    const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fromEnv) {
        return path.isAbsolute(fromEnv) ? fromEnv : path.join(__dirname, "..", fromEnv);
    }
    return DEFAULT_KEY_PATH;
};

/**
 * Loads and parses the service-account object, or returns null when no
 * credential is available (so callers can fail with a clear 500 instead
 * of crashing at boot).
 */
const loadServiceAccount = () => {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }
    const keyPath = resolveKeyPath();
    if (fs.existsSync(keyPath)) {
        return JSON.parse(fs.readFileSync(keyPath, "utf8"));
    }
    return null;
};

const isConfigured = () => Boolean(loadServiceAccount());

let initialized = false;

const ensureInit = () => {
    if (initialized || getApps().length) {
        initialized = true;
        return;
    }

    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
        throw new Error("Firebase service-account credential not found.");
    }

    initializeApp({ credential: cert(serviceAccount) });
    initialized = true;
};

/**
 * Verifies a Firebase ID token and returns the decoded claims
 * (`uid`, `phone_number`, …). Throws if the token is missing/invalid;
 * callers translate that into a 401.
 */
const verifyIdToken = async (idToken) => {
    ensureInit();
    return getAuth().verifyIdToken(idToken);
};

module.exports = { verifyIdToken, isConfigured };
