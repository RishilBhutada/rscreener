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
import { useSyncExternalStore } from "react";
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

type FB = { app: FirebaseApp; auth: Auth; db: Firestore };
let loading: Promise<FB> | null = null;

/** Loads the SDK on first use only, so an unconfigured build ships none of it.
 *  One shared promise, so the top bar, the account screen and sync never set
 *  up Auth twice. */
export function getFirebase(): Promise<FB | null> {
  if (!firebaseConfigured) return Promise.resolve(null);
  if (!loading) {
    loading = loadFirebase();
    loading.catch(() => { loading = null; });   // offline: try again later
  }
  return loading;
}

async function loadFirebase(): Promise<FB> {
  const [{ initializeApp, getApps }, authMod, dbMod] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);
  const app = getApps()[0] ?? initializeApp(CONFIG as Record<string, string>);
  // Who is signed in is kept in localStorage, not IndexedDB (getAuth's
  // default). Firebase's IndexedDB store closes itself whenever the page is
  // hidden, and Google's pop-up hides it: the sign-in died with "Database is
  // closing" (owner, 12-Oct-2026). The Android WebView writes localStorage
  // to disk within about a second.
  const persistence = [authMod.browserLocalPersistence, authMod.browserSessionPersistence];
  let auth: Auth;
  try {
    auth = authMod.initializeAuth(app, inApp()
      // No pop-up helper in the app: Google sign-in is not offered there, and
      // on a phone the helper loads Google's script and a hidden page BEFORE
      // the saved account is restored - seconds of looking signed out on
      // every start (owner, 13-Oct-2026: "should stay signed in").
      ? { persistence }
      : { persistence, popupRedirectResolver: authMod.browserPopupRedirectResolver });
  } catch {
    auth = authMod.getAuth(app);  // already set up on this page
  }
  return { app, auth, db: dbMod.getFirestore(app) };
}

export async function signInWithGoogle(): Promise<User | null> {
  const fb = await getFirebase();
  if (!fb) return null;
  const { GoogleAuthProvider, signInWithPopup, browserPopupRedirectResolver } = await import("firebase/auth");
  // The helper is passed here, not set on Auth, so the app (which has no
  // Google button) never loads it.
  const res = await signInWithPopup(fb.auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
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

// ---------------------------------------------------------------- who is signed in
/** The account last signed in on this device. Shown while Firebase is still
 *  loading, so the top bar and the account screen never show "signed out" to
 *  someone who is signed in - which is what a cold start of the app looked
 *  like. Cleared as soon as Firebase reports no user. Not synced. */
export type AccountHint = { uid: string; email: string | null; name: string | null; photo: string | null };
/** ready=false: Firebase has not answered yet; `hint` is the last account seen here. */
export type AuthView = { ready: boolean; user: User | null; hint: AccountHint | null };

const HINT_KEY = "rs_account_hint";
const SERVER_VIEW: AuthView = { ready: false, user: null, hint: null };
let view: AuthView | null = null;
const listeners = new Set<() => void>();
let started = false;

function readHint(): AccountHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    return raw ? (JSON.parse(raw) as AccountHint) : null;
  } catch { return null; }
}

function saveHint(h: AccountHint | null) {
  try {
    if (h) localStorage.setItem(HINT_KEY, JSON.stringify(h));
    else localStorage.removeItem(HINT_KEY);
  } catch { /* storage off: the hint is only cosmetic */ }
}

function currentView(): AuthView {
  if (!view) view = { ready: false, user: null, hint: readHint() };
  return view;
}

function publish(next: AuthView) {
  view = next;
  listeners.forEach((f) => f());
}

/** Starts Firebase once per page load, as early as possible. */
export function startAuth(): void {
  if (started || typeof window === "undefined" || !firebaseConfigured) return;
  started = true;
  getFirebase()
    .then(async (fb) => {
      if (!fb) return;
      const { onAuthStateChanged } = await import("firebase/auth");
      onAuthStateChanged(fb.auth, (u) => {
        const hint = u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null;
        saveHint(hint);
        publish({ ready: true, user: u, hint });
      });
    })
    .catch(() => {
      // The SDK could not be downloaded (offline). Keep showing the hint and
      // try again when the connection returns.
      started = false;
      window.addEventListener("online", startAuth, { once: true });
    });
}

function subscribeAuth(cb: () => void) {
  startAuth();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The signed-in user, shared by every screen, with the last-known account
 *  while Firebase loads. */
export function useAuth(): AuthView {
  return useSyncExternalStore(subscribeAuth, currentView, () => SERVER_VIEW);
}
