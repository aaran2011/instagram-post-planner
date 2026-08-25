# Instagram Planner — Complete Handoff (for ChatGPT or any developer)

This document is a full, code-grounded description of the **Instagram Planner** web app so an
assistant can understand and safely modify it *without seeing the code*. Everything here reflects
the actual current source.

---

## 1. What the app is and its purpose

A **personal, single-user Instagram content planner and auto-publisher** for a wildlife/bird
photographer. It is deliberately **not** a SaaS/multi-user product — one owner, one Instagram
account. Core job: take the owner's photos/videos, generate captions + hashtags + a posting
schedule, preview them as an Instagram-style grid/calendar, and **actually publish to Instagram
automatically at scheduled times** (real API, not fake). It is honest about real Instagram API
limits rather than faking them.

Two newer capability areas were added on top:
- **Edit Images** — learn the owner's personal photo-editing style from before/after pairs and
  apply it to new photos (non-generative, real photographic adjustments only).
- **AI Reel Creator** — analyze the owner's best-performing reels, auto-assemble an *editable
  storyboard* from their own media, optionally bake in their own music, and schedule a finished
  vertical video as a Reel through the existing calendar.

**Live:** https://instagram-post-planner.vercel.app
**Repo:** github.com:aaran2011/instagram-post-planner (branch `main`, auto-deploys to Vercel).

---

## 2. Tech stack & how to run

- **Next.js 14 (App Router) + TypeScript + React 18.** `strict: true`; `noUnusedLocals` is OFF.
- **No server-side image/video libraries** (no `sharp`, no server ffmpeg). All thumbnailing,
  image editing, and video muxing happen **client-side (canvas / ffmpeg.wasm)**. This is a hard
  architectural constraint driven by Vercel's free serverless (short timeouts, no native deps).
- **Styling:** one global stylesheet `app/globals.css` (design tokens + classes). No CSS framework.
  Inline `style={}` is used liberally in components alongside the shared classes.
- **State:** a single client store via React context (`components/ui.tsx` `useApp()`), seeded by a
  server-rendered `ClientState`. Almost every action calls a REST route and folds the JSON response
  back into state with `setState`.
- **Persistence:** pluggable — **Upstash Redis** (whole-DB JSON) + **Vercel Blob** (media) in
  production; **local JSON file + disk** in dev. Chosen automatically by env vars.

**Scripts** (`package.json`):
- `npm run dev` — dev server on **https://localhost:4321** (uses `--experimental-https` with
  self-signed certs in `./certificates`). HTTPS is required for the Instagram OAuth redirect.
- `npm run build` — `next build`. Must pass clean before deploying.
- `npm run lint`.

**Deploy:** push to `main` → Vercel builds and deploys automatically.

---

## 3. High-level architecture & request flow

```
Browser (React client, useApp store)
  │  fetch() to /api/* (JSON)
  ▼
Next.js App Router route handlers (app/api/**/route.ts)   ← all guarded by session (except noted)
  │  readDb()/updateDb()  (lib/db.ts)
  ▼
Storage backend (lib/kvstore.ts, lib/blobstore.ts)
  • Upstash Redis  ← whole DB as one JSON value at key "igplanner:db"
  • Vercel Blob    ← media files (public CDN URLs)
  (or local ./data/db.json + ./data/uploads + ./data/thumbs in dev)
```

- **`app/page.tsx`** (server component): if `getSession()` is null → redirect `/login`; else builds
  `buildClientState()` and renders `<AppShell initial=… email=… />`.
- **`AppShell`** (`components/AppShell.tsx`): the whole authenticated UI — sidebar nav, top bar,
  view switching, toasts, and the three global modals (Post, Connect, Growth). It also runs a
  **client-side scheduler ping** every 60s (`POST /api/scheduler/tick`) so due posts publish while
  the app is open, and refreshes state when something published.
- **Views** live in `components/views/*` and are switched by a `view` string in `AppShell`.

`readDb()` reads a fresh copy every request and `updateDb(fn)` reads → mutates → writes the whole
object. This is correct for stateless serverless and fine for a single user, but means **all writes
are last-write-wins on the entire DB object** (no partial/atomic field updates).

---

## 4. Data model (the entire DB shape)

Defined in `lib/types.ts`; defaults in `lib/db.ts` (`withDefaults`). The DB is one object:

```ts
Database = {
  media:     MediaItem[]
  posts:     Post[]
  settings:  Settings
  instagram: InstagramAccount
  editStyle?: EditStyle | null          // learned photo-editing style (added feature)
  secrets:   { instagramAccessToken: string | null }   // SERVER-ONLY, never sent to client
  auth:      { passwordHash: string | null,            // scrypt "salt:hash" from a password reset
               reset: { codeHash, expires, attempts } | null }   // SERVER-ONLY
}
```

**MediaItem:** `id`, `type: "photo"|"video"`, `originalName`, `mime`, `size`, `width`, `height`,
`duration` (videos), `file` (storage key / blob URL), `thumb` (key), `fileUrl`/`thumbUrl` (absolute
public URLs in Blob mode; null on disk), `igUrl` (aspect-padded copy for Instagram — see §11),
`createdAt`, `analysis: MediaAnalysis | null`.

**MediaAnalysis:** `subject, contentType, visualTheme, mood, context, audience, category,
format ("post"|"reel"), colors[3], similarityGroup`.

**Post:** `id`, `mediaId` (cover/first item), `mediaIds?` (all items; >1 = carousel), `order`,
`caption`, `hashtags[]`, `cta`, `category`, `mood`, `subject`, `format ("post"|"reel")`,
`music: {name, artist, supportedByApi:false} | null`, `scheduledAt` (ISO UTC instant),
`timezone` (IANA, for display), `status`, `igMediaId`, `error`, `publishedAt`, `createdAt`,
`updatedAt`.
**PostStatus:** `"draft" | "scheduled" | "publishing" | "published" | "demo_published" | "failed"`.

**InstagramAccount:** `connected, username, igUserId, accountType, connectedAt, demo`.

**Settings:** `timezone` (default `Asia/Kolkata`), `defaultTimes[]` (default `["11:00","19:30"]`),
`postingCadenceDays` (default 1), `aiTone`, `aiEmojis`, `niche` (default
`"wildlife & nature photography"`), `demoMode` (default **true** unless `DEMO_MODE=false`).

**EditStyle** (added): `adjustments: EditAdjustments`, `pairs` (how many before/after pairs),
`trainedAt` (ISO), `notes` (human summary). **EditAdjustments** = 10 normalized `-1..1` knobs:
`exposure, contrast, temperature, tint, saturation, vibrance, highlights, shadows, whites, blacks`.

**Client-facing state** (`lib/state.ts` `buildClientState`, type `ClientState`): media (public URLs,
no secrets), posts, settings, instagram, **editStyle**, `config` (booleans from `configStatus()`),
`limitations` (IG limitation strings). **Secrets and auth are never serialized to the client.**

---

## 5. Storage backends & environment variables

**Backend selection is automatic:**
- Redis is used iff `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) are
  set (`lib/kvstore.ts`). Whole DB stored at key `igplanner:db`; heartbeat at `igplanner:lasttick`.
- Blob is used iff `BLOB_READ_WRITE_TOKEN` is set (`lib/blobstore.ts`). **The Blob store must be
  created *Public*** (private rejects `access:"public"`; access mode is immutable → must recreate).
- Otherwise dev: `./data/db.json`, `./data/uploads`, `./data/thumbs`.

**Full env var list (with defaults):**
| Var | Purpose | Default |
|---|---|---|
| `APP_EMAIL` | login email | `you@example.com` |
| `APP_PASSWORD` | login password (fallback if no reset hash) | `changeme` |
| `SESSION_SECRET` | HMAC key for session cookie | insecure hardcoded default |
| `DEMO_MODE` | if `"false"`, real publishing on by default | demo ON |
| `DEFAULT_TIMEZONE` | default settings tz | `Asia/Kolkata` |
| `ANTHROPIC_API_KEY` | enables real AI vision captions | "" (uses demo engine) |
| `ANTHROPIC_MODEL` | model id | `claude-sonnet-5` |
| `PUBLIC_BASE_URL` | public URL IG fetches disk media from | "" |
| `INSTAGRAM_APP_ID` (`META_APP_ID`) | IG app id | "" |
| `INSTAGRAM_APP_SECRET` (`META_APP_SECRET`) | IG app secret | "" |
| `INSTAGRAM_REDIRECT_URI` (`META_REDIRECT_URI`) | OAuth redirect | `http://localhost:4321/api/instagram/callback` |
| `IG_ACCESS_TOKEN` | manual long-lived token (skips OAuth) | "" |
| `IG_USER_ID` | manual IG user id | "" |
| `RESEND_API_KEY` | enables password-reset emails | unset |
| `MAIL_FROM` | reset email sender | `Instagram Planner <onboarding@resend.dev>` |
| `SCHEDULER_KEY` | shared key for external cron to call the tick | unset |
| `UPSTASH_REDIS_REST_URL/TOKEN` (`KV_REST_API_URL/TOKEN`) | Redis DB | unset → local JSON |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob media | unset → local disk |
| `NODE_ENV` | cookie `secure` only when `production` | — |

---

## 6. Authentication (single-user)

- **Login:** `POST /api/auth/login {email, password, remember}`. `verifyCredentials` (`lib/auth.ts`):
  email must equal `APP_EMAIL` (timing-safe); password checked against `db.auth.passwordHash`
  (scrypt) **if a reset was ever done**, otherwise against `APP_PASSWORD`. If the DB read throws,
  it falls back to `APP_PASSWORD` (owner never locked out during a storage outage).
- **Session cookie:** name **`ig_planner_session`**, value = `base64url(payload).base64url(HMAC-SHA256)`
  where payload `{sub, exp}` (exp = now + 30 days), signed with `SESSION_SECRET`. Flags: `httpOnly`,
  `sameSite=lax`, `secure` only in production, `path=/`. "Keep me signed in" (`remember`, default
  true) sets a 30-day `maxAge`; false = browser-session cookie (but the token's own exp is still 30d).
- **Logout:** `POST /api/auth/logout` clears the cookie.
- **Session probe:** `GET /api/auth/session` (public) → `{authenticated, email, config}`.
- **Forgot password** (UI reveals the link only after **2 failed logins**): `POST /api/auth/forgot`
  needs `RESEND_API_KEY`; if the email matches `APP_EMAIL` it emails a 6-digit code (SHA-256 hashed,
  stored in `db.auth.reset`, 10-min expiry, throttled to ~1/min). `POST /api/auth/reset` verifies the
  code (max **5 attempts**), then sets `db.auth.passwordHash` (scrypt) which **overrides
  `APP_PASSWORD`** thereafter. Responses are enumeration-resistant.
- **Route guard:** `guard()` (`lib/api.ts`) returns 401 if `getSession()` is null; used by all
  data/mutation routes. Instagram `auth`/`callback` use `getSession()` directly (redirect to
  `/login`). The scheduler tick allows **session OR `?key=SCHEDULER_KEY`**.

**Security caveats to know:** default `SESSION_SECRET`/`APP_PASSWORD` are insecure placeholders
(tokens forgeable if the default secret is left in place); cookie is non-secure outside production;
token valid 30 days regardless of "remember". `configStatus()` surfaces `defaultCredentials` and
`defaultSessionSecret` warnings but nothing blocks login.

---

## 7. Navigation & pages

Two Next.js pages: `/login` and `/` (the app). The app is a single-page shell; "pages" are **views**
switched client-side. Sidebar order (`AppShell` `navItems`), with the `View` union
`"upload"|"edit"|"reel"|"plan"|"calendar"|"review"|"automation"|"settings"`:

1. **Upload** (badge = media count)
2. **Edit Images**
3. **Reel Creator**
4. **Your Plan** (badge = post count)
5. **Calendar**
6. **Review**
7. **Automation** (badge = scheduled count)
8. **Settings**

Plus a sidebar Instagram row (`@handle` if connected, else "Connect Instagram"), a "Log out" row, a
top-bar **"Grow followers"** button, a **Demo mode** pill (when on), and the IG connection pill.
The brand logo is an original SVG aperture mark (`Logo` in `components/icons.tsx`), also used as the
favicon (`app/icon.svg`). Initial view = `plan` if posts exist, else `upload`.

On `≤900px` the sidebar becomes an off-canvas drawer with a hamburger + scrim.

---

## 8. Feature-by-feature (every screen, button, endpoint)

### 8.1 Upload (`components/views/UploadView.tsx`)
Entry point: upload media, manage the library, build carousels, start plan generation.
- **Hero dropzone / "Browse Files":** accepts JPG/PNG/WEBP/MP4/MOV (`isAccepted`); unsupported files
  toasted and skipped. Two upload paths per file:
  - **Direct-to-Blob** when `config.blobDirect` AND file > 4 MB: `@vercel/blob/client upload()` →
    `handleUploadUrl:/api/blob/upload`, then `POST /api/media/register`; 120s abort timeout;
    concurrency 6.
  - **Server route** otherwise: `XMLHttpRequest POST /api/upload` (multipart); concurrency 3.
  - **`igUrl` padding:** in blobDirect mode it first runs `padForInstagram(file)` and uploads the
    padded copy as `igUrl` (see §11). Falls back to original if padding fails.
- **Library:** segmented **All/Photos/Videos** filter; **Select all/Clear**; **Delete** selected
  (`POST /api/media/delete {ids}`, also strips posts using them); **Delete all**; **Add more**.
- **Generate Plan** (CTA card + toolbar): `POST /api/plan/generate {mediaIds}` (selected, or all).
  Shows `GenerateOverlay` (kept ≥2.6s), toasts count, navigates to **Calendar**.
- **`<PostComposer/>`** rendered inline (carousel builder).
- Empty state offers **"Connect Instagram first"**.

### 8.2 PostComposer (`components/PostComposer.tsx`) — carousel builder
- One or more **boxes**; **"New post"** adds a box. Drag-drop or **Add** to put photos in a box
  (uploads via shared `uploadFile()`, added to library + box).
- ≥2 images → in-box carousel preview (‹/› paging, n/N counter, dots). ✕ removes current image;
  trash removes the box (won't remove the last one).
- **"Generate & add to calendar (N)":** `POST /api/plan/generate {groups: string[][]}` — each group
  becomes one post (>1 = carousel), **added** to the existing calendar; resets and navigates to
  Calendar. (Distinct from Upload's flat `mediaIds` generate.)

### 8.3 Edit Images (`components/views/EditView.tsx`) — learned photo editing
Two modes toggled at top; a badge shows whether a style is trained.
- **Train style:** two columns ("Before (unedited)" / "After (your edit)"), **3 slots each** (was
  5), with **drag-and-drop or click** to add. **"Learn my style"** (enabled at exactly 3+3):
  client-side loads each pair, `analyzeStats` both, `deriveAdjustments`, `averageAdjustments`, then
  `POST /api/edit-style {adjustments, pairs:3, notes}` to persist. Shows the learned knob values.
- **Edit photos:** drag/drop batch upload; each photo gets the saved style applied and shows a
  **before/after compare slider**. Per-photo **Adjust** opens a modal with 10 sliders (start from the
  learned style; "Reset to style" / "Neutral" / "Apply to all"). **Save** / **Save all to library**
  renders the photo **at full resolution** and uploads it via `uploadFile` so it enters the library
  for planning.
- All adjustments are **purely photographic** — no generative content. See §11 for the engine.

### 8.4 Reel Creator (`components/views/ReelView.tsx`) — storyboard + insights + schedule
- **"What performs best":** on mount `GET /api/reels/insights`. Shows reels analyzed, best day/hour,
  avg caption length, avg likes/comments, top hashtags, and top-reel thumbnails. Degrades gracefully
  (see §12); shows a note when only basic metrics are available or when not connected/demo.
- **Builder start:** select from the media library (videos + photos), **"Auto-create reel"** →
  `autoBuild` makes an editable **storyboard** (strongest video as the hook, rest interleaved).
- **Storyboard editor:** per-clip duration slider, transition select (cut/dissolve/slide/whip),
  per-video speed (0.5–2×), on-screen text, reorder (↑/↓), remove. **Instruction box** accepts plain
  language ("make it faster", "remove the third clip", "use dissolves", "reverse the order") via
  `applyInstruction`. **Music card:** attach an audio file you own.
- **Preview:** a real **9:16 sequenced player** that steps through the clips (photos held for their
  duration, videos played/seeked) with a progress bar and the on-screen text; plays the attached
  **music** synced, with a **Music / Clip-sound** toggle.
- **Export edit plan:** downloads a JSON shot list (order, durations, transitions, text, target
  2160×3840). **Not** a rendered video.
- **Add to Calendar** (`ScheduleReelModal`): pick a **finished vertical video** from the library,
  caption, date/time. If music is attached and "bake" is ticked, it fetches the video via
  `GET /api/media/bytes/[id]`, **muxes the music in client-side** (`muxAudioIntoVideo`, video stream
  copied — no quality loss), uploads the muxed MP4, then `POST /api/posts/create` with that media as
  a **scheduled reel** on the existing calendar. Always shows guidance that Instagram's trending/
  licensed audio can only be added manually in-app.

### 8.5 Your Plan (`components/views/PlanView.tsx`) — Instagram grid
- Grid of cells (drag to reorder → `POST /api/posts/reorder {orderedIds}`; click → PostModal). Cells
  show thumbnail, order badge, type icon, carousel count, a status dot, and scheduled date/time.
- **"Regenerate plan":** confirm → `POST /api/plan/generate {}` (adds posts for any media not yet
  planned — additive, not a wipe). **"Review & Schedule"** → Review. Empty state → Upload.

### 8.6 Calendar (`components/views/CalendarView.tsx`)
- **Month/Week/Day** views; ‹/›/**Today** navigation.
- **Clear calendar:** `POST /api/posts/clear` (posts removed, media kept).
- **Draft banner** (if any `draft` posts): **"Schedule all now"** → `POST /api/publish {}` (flips
  draft/failed → scheduled and immediately publishes anything already due; summary toast) and
  **"Review first"**.
- **Status chips** (colored left border + dot): published=green "Posted ✓", demo_published=blue
  "Posted (demo)", failed=red, publishing=amber, scheduled=blue, draft=amber "Draft — not scheduled".
- **Drag a post to another day** (`moveToDate`): keeps its hour/minute, `POST /api/posts/[id]/schedule`;
  on a 30-min conflict it confirms "Move anyway?" and retries with `force`.

### 8.7 Review (`components/views/ReviewView.tsx`)
Pre-publish summary stat cards (totals, first/last post, IG account or Connect). Final IG grid
preview. **"Publish & Schedule"** opens a confirm modal → **"Confirm & Schedule"** = `POST /api/publish
{}` → summary toast → navigates to Automation. Warns if not connected and not demo. Demo banner when
`demoMode`.

### 8.8 Automation (`components/views/AutomationView.tsx`)
Read-only dashboard, three lists: **Upcoming** (scheduled/publishing), **Published**
(published/demo_published; demo ones labeled "DEMO — NOT PUBLISHED"), **Failed** (each has **Retry**
→ `POST /api/publish {postId}`). Each row has **Edit** → PostModal. No scheduling happens here.

### 8.9 Settings (`components/views/SettingsView.tsx`)
- **Instagram account** card: connected details + **Disconnect** (`POST /api/instagram/disconnect`),
  or **Connect** (opens ConnectModal).
- **Demo mode** toggle → `PATCH /api/settings {demoMode}`.
- **Posting preferences:** timezone, preferred posting times (add/remove), days between posts.
- **Editing style** card: shows trained status/notes or a "Train" button; **Retrain** (→ Edit) and
  **Reset style** (`DELETE /api/edit-style`).
- **AI preferences:** niche, caption tone, emoji toggle (warns if no `ANTHROPIC_API_KEY`).
- **Save preferences** → `PATCH /api/settings {...}`.
- **Configuration** diagnostics rows (AI, Instagram, SESSION_SECRET).

### 8.10 Global modals
- **PostModal** (`components/PostModal.tsx`): live IG-style preview (photo post / carousel / reel
  player) + editor. Edit caption/CTA/hashtags (each regenerable via
  `POST /api/posts/[id]/regenerate {field}`), schedule (date/time/tz with 30-min conflict handling
  via `/schedule`), suggested music (photos only; regenerate/clear), category + Post/Reel toggle.
  Footer: **Remove from plan** (`DELETE /api/posts/[id]`), **Post now**
  (`POST /api/publish {postId}`, hidden once published), **Save Changes**
  (`PATCH /api/posts/[id]` for content, then `/schedule` if time/tz changed).
- **ConnectModal** (`components/ConnectModal.tsx`): three modes via `POST /api/instagram/connect
  {mode, username}` — **oauth** (returns `{redirect}`, browser navigates to `/api/instagram/auth`),
  **manual** (`IG_ACCESS_TOKEN`), **demo** (simulated, editable handle).
- **GrowthModal** (`components/GrowthModal.tsx` + `growth.ts`): a **client-only** best-practices
  strategy plan (`buildGrowthPlan(state)`) tailored to the user's actual content mix — **no API
  call**, explicitly "strategy, not a follower guarantee."

---

## 9. AI plan generation (captions, hashtags, schedule, order)

`lib/ai.ts` `generatePlan(media, settings, {groups?, startOrder?, startAfter?})`:
- **Units:** with `groups` → each group is one post (>1 id = carousel, cover = first). Without groups
  → every item is its own single post.
- **Per-unit content** via `planForItem(cover, settings)`: always computes a **deterministic demo
  baseline** (`lib/ai-demo.ts`), then, **only if `ANTHROPIC_API_KEY` is set**, overlays real
  Claude vision output (`lib/ai-claude.ts`, model `ANTHROPIC_MODEL` default `claude-sonnet-5`, direct
  `fetch` to the Anthropic API, sends the photo thumbnail; any error silently keeps demo output).
- **Order:** grouped mode keeps the user's order; auto mode runs `optimizeOrder` (`lib/ordering.ts`,
  greedy sequencer that avoids putting similar/same-category/same-type items adjacent and balances
  photo/video).
- **Schedule:** `buildSlots(count, {times, cadenceDays, tz, from})` (`lib/schedule.ts`) turns
  `settings.defaultTimes` × cadence into future UTC instants (strictly after `from`, tz-correct).
- **New post status is `"scheduled"`** (important — was `"draft"`, which the auto-publisher skipped).
- Carousels are forced to `format:"post"` (never reel).

**Additive by design:** `POST /api/plan/generate` **appends** to `db.posts` and only plans media not
already on the calendar (auto mode) or the explicit `groups`. `startOrder`/`startAfter` continue the
numbering and scheduling after the last existing post. It **never wipes** the calendar.

**Demo engine themes** (`ai-demo.ts`): 6 themes (travel/food/portrait/product/wildlife/everyday);
`themeByNiche(settings.niche)` maps the niche via regex (wildlife matches bird/nature/animal/etc.).
Everything is seeded from `item.id + originalName` so output is stable and offline. Wildlife theme
has bespoke captions/hashtags/music.

---

## 10. Instagram integration & publishing

`lib/instagram.ts` uses **"Instagram API with Instagram Login"** (graph.instagram.com) — **no
Facebook Page needed** (a Facebook account is only needed to create the Meta app). Scopes:
`instagram_business_basic`, `instagram_business_content_publish`.

- **Connect (OAuth):** `/api/instagram/auth` sets a CSRF `ig_oauth_state` cookie and redirects to the
  authorize URL; `/api/instagram/callback` verifies state, `exchangeCodeForAccount` swaps the code
  for a **long-lived (~60-day) token**, stores account in `db.instagram` and token in
  `db.secrets.instagramAccessToken`. Manual-token and demo modes also exist.
- **Publishing** (`lib/publisher.ts` `publishOne` → `lib/instagram.ts` `publishPost`):
  - **Demo mode short-circuits** — no API call; marks `demo_published`, `igMediaId:"DEMO"`.
  - Real path requires connected + token + igUserId, else `failed`.
  - Single photo = image container; single video = **REELS** container; >1 = **CAROUSEL** with child
    containers. Video containers are **polled** (`waitForContainer`, up to ~60s) until `FINISHED`
    before `media_publish`.
  - Media URL: prefers `media.igUrl` (padded), else `media.fileUrl` (Blob CDN), else needs
    `PUBLIC_BASE_URL` (disk mode). Caption = `caption + cta + hashtags`.
- **Scheduler:** `POST/GET /api/scheduler/tick` (auth: session OR `?key=SCHEDULER_KEY`) runs
  `processDue()` — publishes every post with `status:"scheduled"` whose `scheduledAt <= now` — then
  writes a `lastTick` heartbeat. **Two pingers:** (1) the client pings every 60s while the app is
  open; (2) an **external cron-job.org job hits the tick URL every minute** (the reliable one). A
  GitHub Actions workflow also exists but GitHub throttles it to ~30–60 min. `/api/health` exposes
  `lastTick`/`lastTickSecondsAgo` to confirm the cron is firing.
- **`POST /api/publish`:** `{postId}` publishes one now (`force`); `{}` = "schedule all" (flips
  draft/failed → scheduled, then publishes anything already due) and returns a status summary.

---

## 11. Edit Images engine (`components/edit-engine.ts`, `media-utils.ts`)

- **Non-generative, client-side.** `analyzeStats(img)` samples a downscaled canvas and computes mean
  R/G/B, mean luma, luma spread (contrast proxy), mean saturation, black/white points, and shadow/
  highlight region means. `deriveAdjustments(before, after)` converts the *differences* into the 10
  normalized knobs; `averageAdjustments` averages the 3 pairs and gently damps toward "subtle."
- `renderAdjusted(img, adj, maxDim)` applies the knobs in a standard photographic order (exposure →
  tone regions → contrast → white balance → saturation/vibrance) per-pixel. Preview renders at
  `maxDim≈1400` for speed; **save renders at full resolution** (no quality loss), JPEG q0.95, then
  uploads via the normal upload path so the edited photo joins the library.
- `padForInstagram(file)` (`media-utils.ts`): Instagram feed only allows aspect ratios 4:5–1.91:1 and
  **center-crops** anything outside that. This pads out-of-range photos (blurred bars, full subject
  centered) to the nearest allowed ratio and stores it as the media's **`igUrl`**, which publishing
  prefers — so the bird's head never gets cropped. Only applied to **newly uploaded** photos in
  blobDirect mode (older posts have no `igUrl`).

---

## 12. Reel Creator internals (`reel-engine.ts`, `audio-mux.ts`, insights)

- **Insights** (`GET /api/reels/insights`, `lib/instagram.ts fetchReelHistory`): pulls up to 50 media,
  filters to reels, ranks by **likes + comments** (always available with the current scope). It
  **tries** per-reel insights (views/reach/saves/shares) only on the **top 8** and **stops after the
  first failure** — because the deeper metrics need `instagram_business_manage_insights`, which is
  **deliberately not requested** (the owner said never re-connect). So it degrades to basic metrics
  gracefully. The route computes best posting hour/day, avg caption length, top hashtags. Has
  `maxDuration=30`.
- **`autoBuild(media, patterns)`** scores media (videos anchor; vertical/sharp/analyzed rank higher),
  puts the strongest video first as the hook, interleaves the rest, assigns durations (photos ~2s,
  videos clamped 1.5–5s), caps total ~22s, and returns an editable `Storyboard`.
- **`applyInstruction(sb, text)`** parses plain-language edits (faster/slower/remove Nth/dissolves/
  reverse/shorter).
- **Audio mux** (`audio-mux.ts`): loads **ffmpeg.wasm single-threaded core from unpkg via
  `toBlobURL`** (no COOP/COEP / SharedArrayBuffer needed). Command copies the video stream
  (`-c:v copy` → **zero quality loss, 4K preserved**) and encodes only the audio to AAC, with
  `-shortest` + `+faststart`; optional `-stream_loop -1` to cover the whole video. The engine is
  loaded lazily so it never bloats the main bundle. `/api/media/bytes/[id]` streams a library video
  **same-origin** so the muxer avoids cross-origin fetch issues.

**Hard constraint (product decision, do not re-litigate):** the Reel Creator does **not render** a
multi-clip 4K video — that's infeasible on the free serverless stack and unreliable in-browser. It
produces a plan + preview and schedules a **finished** video the user supplies (optionally with their
own music baked in). Instagram's **licensed/trending catalog can never be attached by any API** — it
is always a manual in-app step.

---

## 13. Design system (`app/globals.css`)

- **Accent is blue** `--accent:#3b82f6` (+ `--accent-strong #2563eb`, `--accent-grad` blue→sky used
  for the logo/progress bars). Soft blue-white background `--bg:#f3f7fd`, white surfaces, subtle
  borders. Complementary cyan/indigo/amber/pink tints for pills and Review stat-card top borders.
  Semantic: danger `#e5484d`, success `#30a46c`, warn `#d9820b`. Font **Inter**.
- **Matte, no glow** (explicit owner preference): soft shadows only, subtle 3px translucent-blue focus
  rings, pill buttons (`border-radius:999px`) with a gentle 1px hover lift.
- **Dark mode** via `prefers-color-scheme: dark` (near-black surfaces, inverted text).
- **Layout:** `.app` grid `248px 1fr`, sticky sidebar; active nav item has a 3px accent left edge. At
  ≤900px → off-canvas drawer + hamburger + scrim; PostModal stacks to one column. Toasts bottom-stack.

---

## 14. API endpoint reference

All are `app/api/**/route.ts`, `dynamic="force-dynamic"`, and (unless noted) require a session.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | log in, set cookie |
| `/api/auth/logout` | POST | clear cookie |
| `/api/auth/session` | GET (public) | `{authenticated,email,config}` |
| `/api/auth/forgot` | POST | email reset code (needs Resend) |
| `/api/auth/reset` | POST | set new password from code |
| `/api/state` | GET | full `ClientState` refresh |
| `/api/settings` | PATCH | update settings (incl. `demoMode`) |
| `/api/upload` | POST | multipart upload (≤4MB path) |
| `/api/blob/upload` | POST | Vercel Blob client-upload token route |
| `/api/media/register` | POST | create media record after direct-Blob upload |
| `/api/media/delete` | POST | delete media by ids (+ strip posts) |
| `/api/media/file/[id]` | GET (public) | serve/redirect media (Range support) |
| `/api/media/thumb/[id]` | GET | serve thumbnail |
| `/api/media/bytes/[id]` | GET | **same-origin byte proxy** (for audio muxing) |
| `/api/plan/generate` | POST | additive plan gen (`{}`, `{mediaIds}`, or `{groups}`) |
| `/api/posts/[id]` | PATCH/DELETE | edit / remove one post |
| `/api/posts/[id]/schedule` | POST | reschedule (30-min conflict check, `force`) |
| `/api/posts/[id]/regenerate` | POST | regenerate caption/hashtags/music/recommendation |
| `/api/posts/reorder` | POST | reorder feed (`orderedIds`) |
| `/api/posts/clear` | POST | remove all posts (keep media) |
| `/api/posts/create` | POST | create one scheduled post (used by Reel scheduling) |
| `/api/publish` | POST | `{postId}` publish now, or `{}` schedule-all |
| `/api/scheduler/tick` | GET/POST | publish due posts (session OR `?key=`) + heartbeat |
| `/api/instagram/auth` | GET | start OAuth (sets state cookie) |
| `/api/instagram/callback` | GET | finish OAuth, store token |
| `/api/instagram/connect` | POST | oauth/manual/demo connect |
| `/api/instagram/disconnect` | POST | disconnect |
| `/api/edit-style` | POST/DELETE | save / reset learned editing style |
| `/api/reels/insights` | GET | ranked reel performance + patterns |
| `/api/health` | GET (public) | storage/IG/heartbeat diagnostics (no secrets) |

---

## 15. Status: working / partial / not built

**Fully working:** login + forgot-password; upload (both paths) + library management; carousel
composer; AI plan generation (demo engine always; real Claude captions when `ANTHROPIC_API_KEY` set);
Plan grid + reorder; Calendar (views, drag-reschedule, schedule-all, clear, status chips); Review;
Automation (incl. retry); PostModal editing/regeneration; **real Instagram publishing** (single,
carousel, reel) verified live; **auto-scheduling** via cron-job.org (1-min) + client ping; Edit Images
(train from 3 pairs + drag-drop, batch edit, manual sliders, save to library, Reset in Settings);
Reel Creator (insights, storyboard, instructions, 9:16 preview, export plan, schedule as reel);
reel **music**: preview playback + baking the user's own audio into the video; new logo + favicon.

**Partial / conditional:**
- **Reel insights depth** — only likes+comments unless the insights permission is granted (not
  requested by design); views/reach/saves/shares appear only if that scope exists.
- **Real AI captions** — only with `ANTHROPIC_API_KEY`; otherwise the (good) deterministic demo
  engine is used.
- **`igUrl` aspect-padding** — applied only to newly uploaded photos in blobDirect mode; pre-existing
  media/posts have no `igUrl` and could be cropped by Instagram.
- **Audio muxing** — works for a **single** finished video + user audio; loads a ~30MB engine from a
  CDN on first use (needs network; unpkg availability).

**Not built (intentionally):**
- **No video rendering** — the Reel Creator never renders a multi-clip 4K MP4; it schedules a
  supplied finished video. (Free-serverless constraint + explicit product decision.)
- **No attaching Instagram's licensed/trending music via API** (impossible; manual in-app only).
- **No native Instagram scheduling** — the API publishes immediately; this app does its own scheduling.
- **No multi-user / teams / billing.**

---

## 16. Limitations, gotchas, and things NOT to break

- **Do not change the new-post status back to `"draft"`.** `processDue()` only publishes `scheduled`
  posts, so drafts never auto-post. Generated posts are intentionally `"scheduled"`.
- **`updateDb` writes the whole DB object** (last-write-wins). Avoid introducing concurrent partial
  writers; there's no field-level locking.
- **Vercel Blob store must be Public**, and large files (>4MB) MUST use the direct-Blob path
  (`/api/blob/upload` + `/api/media/register`) — the serverless body limit is ~4.5MB.
- **Publishing needs a public media URL** — Blob CDN URLs work; disk mode needs `PUBLIC_BASE_URL`.
- **Demo mode is ON by default** — nothing publishes for real until it's turned off (Settings) with a
  real connection. Keep the demo short-circuit in `publishOne` intact.
- **Secrets/auth must never enter `ClientState`** — only `lib/state.ts publicMedia`/`buildClientState`
  shape the client payload; keep `db.secrets` and `db.auth` server-side.
- **The scheduler heartbeat + cron-job.org URL** (`/api/scheduler/tick?key=SCHEDULER_KEY`) is what
  makes auto-posting reliable. Don't remove the `key` auth branch or the `setLastTick` call.
- **Audio mux must keep `-c:v copy`** (no video re-encode) to preserve quality/4K; only audio is
  encoded. It uses the **single-threaded** ffmpeg core specifically to avoid needing COOP/COEP headers
  — do not switch to the multi-threaded core without also adding cross-origin isolation (which can
  break Blob/media loading).
- **Instagram aspect ratios** (feed 4:5–1.91:1) — keep `padForInstagram`/`igUrl` behavior or photos
  get cropped again.
- **`app/icon.svg`** is the favicon (Next auto-detects it); keep it in sync with the `Logo` component.
- **Sibling app folders** `fitness-app/`, `ready-app/`, `clothesplanner-app`, `light-it` live in the
  same directory but are **gitignored and unrelated** — never `git add -A` them into this repo.
- **`noUnusedLocals` is off**, but keep `tsc --noEmit` and `next build` green before deploying.

---

## 17. Cross-feature dependencies (change one, check the others)

- **Upload → Plan → Calendar → Review → Automation** all read the same `posts`/`media` in the DB.
  Changing the `Post`/`MediaItem` shape ripples through every view, `buildClientState`, and publishing.
- **Plan generation** depends on `Settings` (times/cadence/tz/niche/tone/emojis) and on `MediaItem`
  presence; it's **additive** (only unplanned media) and relies on `optimizeOrder` + `buildSlots`.
- **Scheduling/auto-publish chain:** post `status:"scheduled"` + `scheduledAt` → `processDue()` →
  `publishOne` → `publishPost`. The Calendar/Review/Automation "publish" buttons and the cron all feed
  this same chain.
- **Edit Images** writes `db.editStyle` (via `/api/edit-style`) and produces new library media (via
  `uploadFile`) that then flow into planning like any upload.
- **Reel Creator** consumes library media + `/api/reels/insights` (needs a real IG connection/token),
  produces a scheduled reel via `/api/posts/create` (which uses the same calendar + scheduler), and
  optionally muxes audio (needs `/api/media/bytes/[id]`).
- **Instagram connection** (`db.instagram` + `db.secrets.instagramAccessToken`) gates real publishing
  **and** reel insights. Demo connection disables both (insights returns a demo note; publishing
  simulates).

---

## 18. Key files map

```
app/
  page.tsx / login/page.tsx           gate + shells
  layout.tsx, icon.svg                metadata + favicon
  globals.css                         design system
  api/**/route.ts                     all endpoints (see §14)
components/
  AppShell.tsx                        nav, view switch, 60s scheduler ping, modals, toasts
  ui.tsx                              View union, useApp() context, Modal/Spinner/Segmented
  store.ts                            ClientState type + api.get/post/patch helpers
  icons.tsx                           all icons + the Logo mark
  views/UploadView, EditView, ReelView, PlanView, CalendarView, ReviewView, AutomationView, SettingsView
  PostComposer, PostModal, ConnectModal, GrowthModal, GenerateOverlay, LoginForm
  media-utils.ts                      thumbnails, padForInstagram, optimizeImage (unused)
  edit-engine.ts                      style learning + photographic apply
  reel-engine.ts                      autoBuild storyboard + applyInstruction
  audio-mux.ts                        ffmpeg.wasm audio muxing
  uploader.ts, growth.ts, tz.ts       helpers
lib/
  types.ts                            all domain types (the DB shape)
  db.ts, kvstore.ts, blobstore.ts     persistence (Redis/Blob or JSON/disk)
  state.ts                            buildClientState (client-safe payload)
  config.ts                           env access + configStatus()
  session.ts, auth.ts, mailer.ts      auth + reset emails
  ai.ts, ai-demo.ts, ai-claude.ts     plan generation (demo + real)
  ordering.ts, schedule.ts            feed order + time slots
  instagram.ts, publisher.ts          IG OAuth/publish + orchestration + reel insights
```

---

*End of handoff. Everything above reflects the current code on `main`.*
