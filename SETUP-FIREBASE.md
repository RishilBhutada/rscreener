# Turning on Google sign-in

Rscreener remembers your watchlist, notes, portfolio, saved screens and theme in
the browser you are using. Sign-in makes them follow you between devices instead.

**Until this is set up nothing changes** — no sign-in button appears, no network
calls are made, and the app behaves exactly as it does today. The code ships
dormant because the project has to be created under your own Google account.

Roughly ten minutes, once.

---

## 1. Create the project

1. Go to <https://console.firebase.google.com> and **Add project**
2. Name it `rscreener` — Google Analytics is not needed, turn it off
3. Once created, click the **web** icon (`</>`) to register a web app, name it
   `rscreener` and skip hosting

You will be shown a `firebaseConfig` block. Keep it open.

## 2. Turn on Google sign-in

1. **Build → Authentication → Get started**
2. **Sign-in method → Google → Enable**, pick a support email, **Save**
3. **Settings → Authorized domains → Add domain**, add `rishilbhutada.github.io`

Without that last step sign-in works locally and fails on the live site.

## 3. Create the database

1. **Build → Firestore Database → Create database**
2. Start in **production mode**, pick the `asia-south1` region
3. Open the **Rules** tab, replace with this, and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // A signed-in person may read and write their own profile and nothing else.
    // This is what makes the config below safe to publish.
    match /profiles/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 4. Give the app the config

Four values from the `firebaseConfig` block go into the build. They are **not
secrets** — a Firebase web config identifies the project and nothing more, and
the rules above are what actually protect the data. Publishing them is the
intended design.

Add them as repository secrets so the build picks them up:

**GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**

| Name | Value from `firebaseConfig` |
|---|---|
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_APP_ID` | `appId` |

Both workflows already pass these through to the build. Push anything, or start a
run from the Data page with scope *rebuild and publish only*, and the **Sign in**
button appears in the top bar.

---

## What syncs

Watchlist · notes on companies · portfolio holdings · saved screens and custom
ratios · theme and accent colour.

**What does not:** the GitHub token used for one-click refresh. That stays on the
device it was entered on, deliberately.

## How merging works

The first time a new device signs in, the two sides are **merged, not
overwritten** — watchlists are unioned and notes combined key by key, so a
watchlist built on the laptop and one built on the phone end up containing both.
After that it is last-write-wins, pushed about a second after you change
anything.

Signing out leaves everything on the device untouched.

## Cost

Free. The Firestore free tier allows 50,000 reads and 20,000 writes a day; this
uses a handful of each. There is no card on file and nothing to cancel.
