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

// The owner's project (rscreener-9ae56, created 12-Oct-2026). Written here,
// not kept as GitHub secrets, because it is public by design - every visitor's
// browser receives it - and the Firestore rules (each user their own
// /profiles/{uid}) are what protect the data. Secrets, if set, still win.
const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDTMccThIjUK-QkuNRz_EPywbx3yiBiaVU",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "rscreener-9ae56.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "rscreener-9ae56",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:842782223773:web:dc118caae4885af2299374",
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
  // Who is signed in is kept in localStorage, not IndexedDB (getAuth's
  // default). Opening Google's pop-up sends this tab to the background, a
  // phone browser closed the IndexedDB connection, and the sign-in died with
  // "Database is closing" (owner, 12-Oct-2026).
  let auth: Auth;
  try {
    auth = authMod.initializeAuth(app, {
      persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence],
      popupRedirectResolver: authMod.browserPopupRedirectResolver,
    });
  } catch {
    auth = authMod.getAuth(app);  // already set up on this page
  }
  cached = { app, auth, db: dbMod.getFirestore(app) };
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

/** A password on the signed-in Google account, so the Android app - where
 *  Google's sign-in page is refused - reaches the SAME account with the Gmail
 *  address and this password (owner, 12-Oct-2026). Firebase keeps one account
 *  per email; this links the second way in rather than making a second one. */
export async function addPassword(password: string): Promise<void> {
  const fb = await getFirebase();
  const user = fb?.auth.currentUser;
  if (!fb || !user?.email) throw Object.assign(new Error("not signed in"), { code: "auth/no-current-user" });
  const { EmailAuthProvider, linkWithCredential } = await import("firebase/auth");
  await linkWithCredential(user, EmailAuthProvider.credential(user.email, password));
  await user.reload();
}

/** Whether the signed-in account can also be entered with a password. */
export function hasPassword(user: User | null): boolean {
  return Boolean(user?.providerData.some((p) => p.providerId === "password"));
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
    "auth/user-not-found": "No account with that email yet - use Create account, or if it is your Google email, set a password on the website first.",
    "auth/email-already-in-use": "This email already has an account - often the Google one. Sign in instead; or, to use it in the app, sign in with Google on the website and choose Set a password for the app.",
    "auth/account-exists-with-different-credential": "This email already has an account - sign in with Google on the website, then choose Set a password for the app.",
    "auth/requires-recent-login": "For safety, sign out and sign in with Google again, then set the password straight away.",
    "auth/provider-already-linked": "This account already has a password.",
    "auth/credential-already-in-use": "Another account already uses this email with a password.",
    "auth/weak-password": "Use a password of at least 6 characters.",
    "auth/invalid-email": "That is not a valid email address.",
    "auth/missing-password": "Enter a password.",
    "auth/too-many-requests": "Too many tries - wait a few minutes and try again.",
    "auth/network-request-failed": "No connection - try again when you are online.",
    "auth/operation-not-allowed": "This kind of sign-in is not switched on in the Firebase project yet.",
    "auth/popup-closed-by-user": "The sign-in window was closed.",
    "auth/unauthorized-domain": "This site is not on the Firebase project's list of allowed domains yet.",
  };
  if (/database.*clos|closing/i.test(String((e as Error)?.message ?? ""))) {
    return "The browser closed its storage while Google's window was open. Try once more; if it repeats, sign in with email.";
  }
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
