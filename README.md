# Instagram Planner

A **private, single‑user** web app to plan your Instagram: connect your Business
account, drop in a big batch of photos & videos, let AI organize them into a
posting plan (captions, hashtags, schedule), preview each post exactly as it
will look, edit anything, review the calendar, and publish/schedule through
Instagram’s official API.

It runs **fully in demo mode with zero configuration** so you can use the entire
workflow immediately. Add API keys when you’re ready to go live.

> This is a personal tool for one person. There is intentionally **no** sign‑up,
> multi‑user, billing, teams, or admin features.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # edit your email + password (see below)
npm run dev
```

Open **http://localhost:4321** and log in.

Everything works out of the box in **demo mode**: upload → generate plan →
Instagram‑style grid → preview & edit → calendar → schedule. Nothing is sent to
Instagram until you configure real API access *and* turn demo mode off in
Settings.

---

## The workflow

1. **Log in** — single private account (your email + password).
2. **Connect Instagram** — real Meta OAuth, a manual token, or a *demo* connection.
3. **Upload** — drag & drop hundreds of JPG/PNG/WEBP/MP4/MOV. Thumbnails,
   duration and dimensions are extracted in your browser for speed.
4. **Generate Plan** — AI analyzes each item and builds captions, hashtags, a
   varied posting order, and a schedule in your timezone.
5. **Your Instagram Plan** — a real 3‑column grid. Drag to reorder. Click any
   post for a full Instagram‑style preview.
6. **Edit** — caption, hashtags, CTA, category, format, music suggestion, and
   date/time. Regenerate any single field without touching the rest.
7. **Calendar** — month / week / day. Drag a post to another day to reschedule.
8. **Review → Publish & Schedule** — confirm, then the app schedules everything.
9. **Automation** — see Upcoming / Published / Failed, with retry on failures.

---

## Configuration (`.env.local`)

Copy `.env.example` to `.env.local`. Nothing is required for demo mode.

| Variable | Purpose |
|---|---|
| `APP_EMAIL`, `APP_PASSWORD` | Your login. **Change these.** |
| `SESSION_SECRET` | Signs your session cookie. Set a long random value in production. |
| `DEFAULT_TIMEZONE` | e.g. `Asia/Kolkata`. Used to build schedules. |
| `DEMO_MODE` | `true` (default) simulates publishing. Set `false` to go live. |
| `ANTHROPIC_API_KEY` | Enables real AI vision analysis & captions. Without it, a built‑in demo content engine is used. |
| `ANTHROPIC_MODEL` | Defaults to `claude-sonnet-5`. |
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | Instagram OAuth (Facebook Login). |
| `IG_ACCESS_TOKEN`, `IG_USER_ID` | Alternative to OAuth: a long‑lived token + IG user id. |
| `PUBLIC_BASE_URL` | A public URL Instagram can reach to **download your media** when publishing. |
| `SCHEDULER_KEY` | Lets the standalone scheduler authenticate (optional). |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The **Settings → Configuration** panel shows, live, what is and isn’t configured.

---

## What Instagram’s API really supports (no fake features)

This app is honest about the platform’s limits:

- **No native scheduling.** The Graph API publishes *immediately*. This app
  stores your schedule and publishes each post at its time using its own
  scheduler — that’s real scheduling, done here, not faked.
- **Instagram fetches your media from a public URL.** Real publishing requires
  `PUBLIC_BASE_URL` to be reachable by Instagram (localhost won’t work — use a
  tunnel like ngrok, or deploy). If it isn’t set, publishing fails with a clear
  message instead of pretending.
- **Music can’t be attached via the API.** For photo posts the app *suggests* a
  song and tells you to add it manually in Instagram. It never claims the song
  was attached.
- **Videos keep their original audio.** The app never adds, replaces, or
  modifies a video’s soundtrack.
- **Business/Creator accounts only**, linked to a Facebook Page you manage.
- A post is only reported **Published** when the Graph API confirms it.
  Failures show the actual error, with Retry.

### Going live checklist
1. Create a Meta app with **Instagram Graph API** + **Facebook Login**.
2. Set `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (or `IG_ACCESS_TOKEN` + `IG_USER_ID`).
3. Set `PUBLIC_BASE_URL` to a public host (tunnel or deployment).
4. Connect your account in the app, then turn **off** Demo mode in Settings.

---

## Unattended scheduling

While the app is open in a tab it checks for due posts every minute. For
publishing when no tab is open, run the standalone scheduler alongside the app:

```bash
SCHEDULER_KEY=yourkey APP_URL=http://localhost:4321 npm run scheduler
```

(Set the same `SCHEDULER_KEY` in `.env.local`.) Or point any cron at
`POST /api/scheduler/tick?key=yourkey`.

---

## Architecture

- **Next.js 14 (App Router) + TypeScript** — one server for UI and secure API.
- **Storage** — media files on disk under `./data/uploads` (+ `./data/thumbs`);
  all app state in a single JSON file `./data/db.json`. To back up, copy `./data`.
  No database or native dependencies to compile.
- **Auth** — single user; HMAC‑signed, httpOnly session cookie.
- **AI** — `lib/ai.ts` abstraction over Anthropic (called server‑side via
  `fetch`) with a deterministic demo engine fallback (`lib/ai-demo.ts`). API keys
  never reach the browser.
- **Instagram** — `lib/instagram.ts` wraps the Graph API; `lib/publisher.ts`
  handles demo vs. real publishing. Access tokens are stored server‑side only.
- **Performance** — browser‑side thumbnailing, lazy‑loaded grids, thumbnail
  endpoints, HTTP Range streaming for video, concurrency‑limited uploads.

### Key paths
```
app/            routes: /login, / (app), /api/*
components/     React UI (AppShell, views/, PostModal, ConnectModal, …)
lib/            db, auth, session, ai, instagram, publisher, scheduling
scripts/        standalone scheduler
data/           your media + db.json (gitignored)
```

---

## Notes & disclaimers

- Content suggestions (captions, hashtags, order, times, music) are just that —
  **suggestions**, not guarantees of growth or performance.
- `npm run build` type‑checks the whole app.
- Reset everything by deleting the `./data` folder.
