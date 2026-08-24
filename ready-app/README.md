# Ready? — are you actually ready?

An AI preparation coach that answers one question before you walk out of the
door: **are you ready for this specific thing?** Not "do you look good" — ready.
It checks your outfit, grooming, camera setup, lighting, background, posture and
preparation, weighted for the occasion you picked, and turns all of it into two
or three things to do right now.

```bash
npm install
npm run dev          # http://localhost:4400
```

Works with no configuration at all (see [Two honest modes](#two-honest-modes)).

---

## The one idea

An outfit checker that docks you for trainers during a **video call** — where
your feet are two metres out of frame — is not checking anything. So the
occasion is chosen first, and it decides three things before a single pixel is
looked at:

| | Online interview | In-person interview | Wedding |
|---|---|---|---|
| Footwear | **not scored** | 4/5 | 4/5 |
| Camera position | **5/5** | 1/5 | not scored |
| Lighting | **5/5** | 1/5 | not scored |
| Background | 4/5 | not scored | not scored |
| Accessories | 1/5 | 2/5 | **4/5** |

Those weights, the questions each occasion asks, and what "appropriate" means to
the vision model all live in one file: [`lib/engine/events.ts`](lib/engine/events.ts).
Adding an occasion is one entry in `EVENTS`; nothing else in the app needs to
know it exists.

## The rule the product is built on

**Anything the app cannot see, it says it cannot see.**

- Shoes out of frame → footwear is excluded from the score and labelled, never guessed.
- No vision model configured → the outfit is *not scored at all*, and the screen says so.
- Nobody found in frame → no score is shown. Two incidental measurements are not a verdict.
- Speech typed instead of spoken → no words-per-minute figure, because that would be typing speed.
- Head orientation is measured; **eye contact is not claimed**, because a body-pose model cannot see where your eyes point.
- Never any assessment of attractiveness, body shape or skin. That is enforced by a filter on the model's output, not just requested in the prompt.

Each of those is covered by a test in [`tests/`](tests).

## Two honest modes

| | With `ANTHROPIC_API_KEY` | Without |
|---|---|---|
| Camera height, framing, posture | ✅ measured on device | ✅ measured on device |
| Lighting, backlight, colour cast, background clutter | ✅ measured on device | ✅ measured on device |
| Outfit, grooming, accessories | ✅ scored by the vision model | ❌ **not scored** — a self-check list is shown instead, labelled "Demo Analysis" |
| Interview prep questions | tailored to your role and interviewer | a real question bank, labelled as such |
| Interview review | substance reviewed by the model | measurable properties only (examples given, results named, length) |
| Pace, filler words, camera presence | measured on device | measured on device |

There is deliberately no third mode where plausible-sounding outfit feedback is
generated from nothing.

```bash
cp .env.example .env.local   # then add ANTHROPIC_API_KEY
```

## What runs where

Nothing about the live preview leaves the device. The only thing that is ever
sent is **one still frame, once, when you tap Analyse** — and only if the "send
one frame" box is ticked. Untick it and you keep every on-device measurement and
simply lose the outfit score.

- **On device (WebAssembly, no network):** MediaPipe pose landmarks → framing,
  camera pitch, posture, centring; canvas pixel statistics → brightness, backlight,
  side-lighting, colour temperature, clipping, background busyness.
- **Sent on request:** one 768px JPEG, for the outfit read.
- **Never sent:** the video stream, any audio, anything at rest. History is
  scores and dates in `localStorage`; there is one button that really deletes it.

The pose model and its wasm runtime are served from this origin (`npm run
setup:vision` puts them in `public/`), so no third party learns that someone is
checking themselves, and framing guidance still works on bad hotel wifi.

## Architecture

```
lib/engine/          the product's brain — no React, fully unit-tested
  events.ts          Context Engine: occasions, questions, weights, rubrics
  device-findings.ts measurements → findings (source: 'device')
  scoring.ts         Scoring Engine: findings → explainable category scores
  recommendations.ts prioritised fixes, time-budget plans, "make me a 10/10"
  communication.ts   pace, fillers, camera presence → delivery report
  readiness.ts       Final Readiness Engine: everything → one score and one word
  types.ts           the shared vocabulary

lib/vision/          camera, on-device pose, framing geometry, pixel statistics
lib/ai/              Anthropic calls + the enforcement pass + the no-key fallbacks
lib/speech/          browser speech recognition, with an honest unsupported path
lib/integrations/    typed seams for wardrobe and weather (deliberately unbuilt)
lib/store/           local history
components/check/    one step per screen, orchestrated by flow.tsx
```

Two structural rules:

1. **The model reports; the engine scores.** The vision model never returns a
   number that reaches your score — it returns observations with a severity, and
   `scoring.ts` owns the arithmetic. Same finding, same cost, every time, which
   is what makes "why did I lose points?" answerable.
2. **Every finding carries its provenance**: `source` (device / model /
   checklist), `kind` (observed / inferred) and `confidence`. The UI labels all
   three, and nothing can enter the score without answering them.

## Scripts

```bash
npm run dev          # dev server on :4400
npm run check        # typecheck + tests
npm test             # 52 tests over the engines and the model-output guards
npm run build        # production build
npm run setup:vision # re-fetch the pose model and wasm runtime
```

## Designed for, not built

Three features have typed seams and no implementation, and an unconfigured
integration is **invisible** — no greyed-out buttons, no "coming soon", no
permission prompt for a feature that does not exist:

- **Digital wardrobe** (`lib/integrations/wardrobe.ts`) — photograph what you
  own; fixes become "wear the brown shoes you already have".
- **Weather** (`lib/integrations/weather.ts`) — comfort advice for outdoor
  events. Location is only ever requested from a user gesture, and only when a
  key is configured.
- **Synced history** — the stored shape is already what a server would return.

## Known limits

- Speech recognition is browser-provided; on Chrome that means audio is
  processed by Google's service. The interview screen says so before it starts.
  Firefox has none, so the interview runs on typed answers and every
  audio-derived number is reported as not measured.
- Camera pitch, head yaw and slouch are approximations from a 2D projection.
  They are good enough to say "raise the phone about 20 cm" and are always
  presented as approximate.
- iOS Safari requires a user gesture before the camera opens — which is the flow
  anyway, since nothing starts until you tap **Turn on the camera**.
