/** Firebase, loaded only if it has been configured.
 *
 *  These NEXT_PUBLIC_ values are meant to be public. Unlike the GitHub token,
 *  which grants write access and must never be in shipped code, a Firebase web
 *  config identifies the project and nothing more - security comes from the
 *  Firestore rules on the server, which say a signed-in user may touch only their
 *  own document. So this can sit in a public repository safely.
 *
 *  When the config is absent the whole feature stays dark: no sign-in button, no
 *  network calls, everything works exactly as it did on local storage alone. That
 *  matters because the project has to be created by the owner under his own Google
 *  account, and the app must not be broken in the meantime.
 */
import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(CONFIG.apiKey && CONFIG.projectId && CONFIG.appId);

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

/** Loads the SDK on first use only, so an unconfigured build ships none of it. */
export async function getFirebase() {
  if (!firebaseConfigured) return null;
  if (cached) return cached;
  const [{ initializeApp, getApps }, authMod, dbMod] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);
  const app = getApps()[0] ?? initializeApp(CONFIG as Record<string, string>);
  cached = { app, auth: authMod.getAuth(app), db: dbMod.getFirestore(app) };
  return cached;
}

export async function signInWithGoogle(): Promise<User | null> {
  const fb = await getFirebase();
  if (!fb) return null;
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const res = await signInWithPopup(fb.auth, new GoogleAuthProvider());
  return res.user;
}

/** Inside the Android app - a Capacitor shell around this site. Google's
 *  sign-in page refuses to load in an app's built-in browser ("disallowed
 *  user agent"), so the app offers email and password only. */
export function inApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** Email and password: works in the app and in any browser. `create` makes
 *  the account the first time. */
export async function signInWithEmail(email: string, password: string, create = false): Promise<User | null> {
  const fb = await getFirebase();
  if (!fb) return null;
  const mod = await import("firebase/auth");
  const res = create
    ? await mod.createUserWithEmailAndPassword(fb.auth, email.trim(), password)
    : await mod.signInWithEmailAndPassword(fb.auth, email.trim(), password);
  return res.user;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const fb = await getFirebase();
  if (!fb) return;
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(fb.auth, email.trim());
}

/** Firebase's error codes, said plainly. */
export function authMessage(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? "");
  const known: Record<string, string> = {
    "auth/invalid-credential": "That email and password do not match an account.",
    "auth/wrong-password": "That email and password do not match an account.",
    "auth/user-not-found": "No account with that email yet - use Create account.",
    "auth/email-already-in-use": "There is already an account with that email - sign in instead.",
    "auth/weak-password": "Use a password of at least 6 characters.",
    "auth/invalid-email": "That is not a valid email address.",
    "auth/missing-password": "Enter a password.",
    "auth/too-many-requests": "Too many tries - wait a few minutes and try again.",
    "auth/network-request-failed": "No connection - try again when you are online.",
    "auth/operation-not-allowed": "This kind of sign-in is not switched on in the Firebase project yet.",
    "auth/popup-closed-by-user": "The sign-in window was closed.",
    "auth/unauthorized-domain": "This site is not on the Firebase project's list of allowed domains yet.",
  };
  if (code.startsWith("auth/api-key-not-valid")) return "The site's Firebase settings are wrong - check the four FIREBASE_ secrets on GitHub.";
  return known[code] ?? String((e as Error)?.message ?? e);
}

export async function signOutOfGoogle(): Promise<void> {
  const fb = await getFirebase();
  if (!fb) return;
  const { signOut } = await import("firebase/auth");
  await signOut(fb.auth);
}

export async function watchUser(cb: (u: User | null) => void): Promise<() => void> {
  const fb = await getFirebase();
  if (!fb) { cb(null); return () => {}; }
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(fb.auth, cb);
}
