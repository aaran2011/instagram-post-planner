# Deploying Instagram Planner to Vercel (free)

This app runs on **Vercel (Hobby/free)** with:
- **Vercel Blob** — stores your photos (public CDN URLs Instagram can fetch)
- **Upstash Redis** — stores the app data (replaces the local `db.json`)
- **cron‑job.org** — free pinger that triggers scheduled posts every minute

> Free‑tier note: Vercel functions run up to ~10s on Hobby. **Photo** posts are
> well within that. Video/Reel posts can take longer and may time out on free —
> treat the free deployment as a photo scheduler.

---

## 1. Push the code to GitHub
A git repo is already initialized with an initial commit (secrets are gitignored).
Create an **empty** repo on github.com (no README), then:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

## 2. Create the storage
**Upstash Redis** (database):
1. https://upstash.com → sign up (free) → **Create Database** → **Redis** → pick a region → Create.
2. Open the database → **REST API** → copy **`UPSTASH_REDIS_REST_URL`** and **`UPSTASH_REDIS_REST_TOKEN`**.

**Vercel Blob** (media): created inside Vercel in the next step.

## 3. Import into Vercel
1. https://vercel.com → **Add New… → Project** → import your GitHub repo → **Deploy**
   (the first deploy may show the app in demo mode — that's fine; we add env next).
2. In the project: **Storage → Create → Blob** → connect it. This adds
   `BLOB_READ_WRITE_TOKEN` to the project automatically.

## 4. Add environment variables
Project → **Settings → Environment Variables** → add (Production):

| Name | Value |
|---|---|
| `APP_EMAIL` | your login email |
| `APP_PASSWORD` | a strong password |
| `SESSION_SECRET` | long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `DEMO_MODE` | `false` |
| `DEFAULT_TIMEZONE` | e.g. `Asia/Kolkata` |
| `INSTAGRAM_APP_ID` | from your Meta app |
| `INSTAGRAM_APP_SECRET` | from your Meta app |
| `INSTAGRAM_REDIRECT_URI` | `https://<your-app>.vercel.app/api/instagram/callback` |
| `UPSTASH_REDIS_REST_URL` | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
| `SCHEDULER_KEY` | any random string |
| `ANTHROPIC_API_KEY` | optional (real AI captions) |

Then **Deployments → … → Redeploy** so the vars take effect.

## 5. Point Meta at your Vercel URL
In your Meta app → **Instagram → API setup with Instagram login → Business login
settings → Valid OAuth Redirect URIs**, add exactly:
```
https://<your-app>.vercel.app/api/instagram/callback
```

## 6. Connect Instagram
Open `https://<your-app>.vercel.app` → log in → **Connect Instagram → Continue
with Instagram** → authorize. (No tunnel, no cert warnings — it's a real domain.)

## 7. Turn on scheduling (free, precise)
https://cron-job.org → sign up (free) → **Create cronjob**:
- URL: `https://<your-app>.vercel.app/api/scheduler/tick?key=<YOUR_SCHEDULER_KEY>`
- Schedule: **every 1 minute**

That endpoint publishes any posts whose time has arrived. Set‑and‑forget.

---

## How storage is chosen
The same code runs locally and on Vercel:
- If `UPSTASH_REDIS_REST_URL` is set → data goes to Redis; otherwise `./data/db.json`.
- If `BLOB_READ_WRITE_TOKEN` is set → media goes to Vercel Blob; otherwise `./data/uploads`.

So local dev needs no cloud accounts, and production needs no code changes.
