# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Amcar** — a mobile app for finding nearby car mechanics in Georgia (the country). Two parts in one repo:

- `client/` — Expo / React Native app (SDK 54, RN 0.81, React 19, **New Architecture on**). The map *is* the product.
- `server/` — Express 5 + MongoDB (Mongoose) + Socket.io REST/realtime API.
- `tools/` — bundled `cloudflared.exe` for exposing the local server over a public tunnel (dev sharing).

The product was renamed from "CarMaster"/"sando" to "Amcar". Several **technical identifiers intentionally stay `carmaster`**: the app `scheme`, AsyncStorage/SecureStore keys (`carmaster.token`, `carmaster.user`), the Firebase project (`carmaster-7a9c0`), and the Mongo database name (`CarMaster`). Don't "fix" these to `amcar` — it breaks existing sessions/data.

## Commands

Run client commands from `client/`, server commands from `server/`.

```bash
# Client (Expo)
npx expo start            # Metro dev server; scan QR with Expo Go
npx expo start -c         # REQUIRED after changing .env, app.json, or first use of a native/worklet feature (clears cache)
npx expo run:android      # build to emulator/device
npx expo run:ios

# Server (no start script defined)
nodemon app.js            # dev with auto-reload (this is how it's normally run)
node app.js               # plain run
```

There is **no test suite** (the server `test` script is a stub) and **no linter configured**. Verify changes by running the app and exercising the flow, or by hitting the API with `curl` (server listens on port 3000).

## Environment & connectivity

- **Server** needs `server/.env`: `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY` (OTP email is sent via Resend's HTTPS API in `email.util.js` — SMTP/Gmail is **not** used because Render blocks outbound SMTP ports; optionally set `RESEND_FROM` once you verify a sending domain, otherwise it defaults to `onboarding@resend.dev`, which only delivers to your own Resend account email), `ADMIN_EMAILS` (comma-separated; these emails are auto-promoted to `admin` on every request via `protect.middleware.js`), `FIREBASE_SERVICE_ACCOUNT` (the Firebase service-account JSON as a single-line string — used by `firebaseAdmin.util.js` to verify the ID token from phone-number sign-in; or set `GOOGLE_APPLICATION_CREDENTIALS` to a file path instead).
- **Client API base URL** is resolved in `client/src/config/index.js` → `resolveApiUrl()`, in priority order:
  1. `EXPO_PUBLIC_API_URL` from `client/.env` (e.g. a Cloudflare tunnel) — **overrides everything, including production**. `EXPO_PUBLIC_*` vars are inlined at bundle time, so editing `.env` requires `expo start -c`.
  2. `PRODUCTION_API_URL` constant when `!__DEV__`.
  3. Dev fallback: auto-derives the LAN IP from Metro's `hostUri` (Android emulator remaps `localhost`→`10.0.2.2`).
- All client requests go through `client/src/api/client.js` → `${API_URL}/api/v1<path>`, JWT sent as `Authorization: Bearer`. The server binds `0.0.0.0` and CORS reflects the origin, so a physical phone reaches the laptop by LAN IP.

## Architecture

**Auth** is passwordless: email + 4-digit OTP (`auth.controller.js`, emailed via Resend's HTTPS API in `email.util.js`) or Google OAuth. Issues a 30-day JWT. Client stores the JWT in **SecureStore** (encrypted) and caches the user profile in **AsyncStorage**; both live in `AuthContext` (`client/src/context/AuthContext.js`), which also exposes `signIn/signOut/updateUser` and favorites helpers (`isFavorite`, `toggleFavorite`). `AppServices` (mounted while signed in) wires push-token sync and the realtime socket.

**Mechanics & geo search** (`mechanic.controller.js` + `mechanic.model.js`): each mechanic has a `coordinate {lat,lng}` and a GeoJSON `location` mirror kept in sync by model hooks (and `backfillLocations()` on boot) to power a `2dsphere` index. `GET /mechanics` runs `$geoNear` when `lat/lng` are present (nearest-first, attaches `distanceMeters`), else a rating sort. Query params: `service`, `openNow`, `minRating`, `sort=rating`, `radius` (km, **default 1000** — generous because the catalogue is currently a single city; tighten when coverage expands), `lat/lng`, `search`. The home sheet ("Nearby") sends `radius=5`; the full catalogue screen (`AllMechanicsScreen`) sends `sort=rating` with no location.

**Mechanic service data is stored in Georgian.** Filter-chip keys (`oil`, `brakes`, …) map to regexes in `SERVICE_PATTERNS` that must match **both English and Georgian** keywords — English-only patterns silently return zero results.

**Images are host-independent.** Avatars and mechanic photos are written to disk under `server/uploads/{avatars,mechanics}/` and served statically at `/uploads`. They are stored as **relative paths** (`/uploads/...`), never with a host — because the dev server's IP/tunnel changes and any baked-in host would break the URL. The client resolves them with `client/src/utils/media.js` → `resolveMediaUri()`, which re-bases any `/uploads/...` reference onto the current `API_URL` (this also auto-repairs legacy absolute URLs). When rendering any uploaded image, wrap the URI in `resolveMediaUri`; when storing one server-side, store the relative path.

**Realtime** (`server/app.js`): Socket.io shares the HTTP server. The handshake verifies the same JWT; authenticated sockets join `user:<id>`, and `mechanic`/`admin` accounts join the `responders` room. Events: `mechanic:new` (broadcast), `sos:new` (→ responders), `sos:accepted` (→ requester). Controllers reach io via `req.app.get("io")`. Push notifications mirror these (`utils/push.util.js`, Expo).

**Directions**: `GET /directions` proxies the Google Directions API server-side so the Maps key never ships in the app. The map draws the returned road polyline; distance/duration shown during navigation are real Google values, while the per-card ETA in lists is a rough `km × 2` estimate.

## Client conventions

- **Reanimated 4 + Gesture Handler** (UI-thread animation) are used for smooth gestures (e.g. `components/BottomSheet`). There is **no `babel.config.js`** — Expo's default transform applies `babel-preset-expo`, which auto-enables the worklets plugin because `react-native-worklets` is installed. **Do not add a `babel.config.js` that references `babel-preset-expo`**: the `node_modules` layout is non-standard (nested, not hoisted) and the preset is unresolvable from the project root, which would break the build.
- Navigation is a single headerless native-stack (`navigation/StackNavigator.js`); there are no tab bars. Movement happens via the bottom-rising `MenuSheet`, the draggable bottom sheet, and map markers.
- Theming via `theme/ThemeContext` (light/dark + design tokens in `constants/`); always pull colors/spacing/typography from there. Styles are built with a memoized `createStyles(colors, ...)` pattern.
- i18n via `react-i18next` with `en` and `ka` (Georgian) — add every user-facing string to **both** `i18n/en.js` and `i18n/ka.js`.
- `HomeMapScreen` re-renders frequently (GPS ticks). It is heavily memoized; keep map markers/`MechanicMarker` cheap and avoid putting live location into fetch-effect dependencies (use a ref + a one-shot `hasFix` trigger, as already done).
