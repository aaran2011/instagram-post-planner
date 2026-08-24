/**
 * The vision + language calls, over plain fetch so there is no SDK dependency.
 *
 * Two design rules run through this file:
 *
 *  1. The model reports, the engine scores. Nothing here returns a number that
 *     lands in the user's score — it returns observations with a severity, and
 *     lib/engine/scoring.ts owns the arithmetic. That keeps scoring consistent
 *     between two runs of the same outfit and makes it explainable.
 *
 *  2. The model is told, at length, what it must not do: no attractiveness, no
 *     body commentary, no claims about things it cannot see. Those constraints
 *     are in the system prompt AND enforced again when parsing the response,
 *     because a prompt is a request and a filter is a guarantee.
 */

import { aiConfig } from './config';
import { getEvent, eventName, isOnline } from '../engine/events';
import type { CheckContext, Confidence, Finding, Severity, Unavailable } from '../engine/types';

type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

async function callClaude(system: string, content: Block[], maxTokens = 1400, signal?: AbortSignal): Promise<string> {
  const res = await fetch(aiConfig.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': aiConfig.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: aiConfig.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    }),
    signal: signal ?? AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('The model did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/** Shared preamble. Every call gets the same non-negotiables. */
const HOUSE_RULES = [
  'You are the vision half of a preparation coach. The person in the frame asked for this check and wants to walk out of the door feeling more confident, not less.',
  '',
  'Absolute rules, in order of importance:',
  '1. NEVER assess attractiveness, beauty, facial features, body shape, weight, skin, or physique. Not as praise, not as criticism, not as a hint. Assess grooming, neatness, fit of clothing, coordination, and appropriateness for the occasion — nothing else about the body.',
  '2. NEVER describe something you cannot actually see in the image. If the shoes are out of frame, the shoes do not exist for you. If the lighting makes a colour ambiguous, say the confidence is low rather than guessing.',
  '3. Judge against the OCCASION you are given, not against a universal idea of smartness. Under-dressing and over-dressing are both real problems; a perfectly good outfit for the wrong event is a real problem too.',
  '4. If something is already right, say so. Do not invent problems to seem useful. An outfit with nothing wrong should come back with strengths and no criticisms.',
  '5. Every criticism must come with a specific physical action the person can take in the next few minutes, using what they already own. Never tell someone to buy something or to change their entire outfit.',
  '6. Separate what you SEE (kind: "observed") from what you CONCLUDE (kind: "inferred"). "The shirt is untucked" is observed. "This reads too casual for a client meeting" is inferred.',
  '7. Be warm and direct. Short sentences. No flattery, no lecturing, no shaming.',
].join('\n');

const CATEGORY_RULE =
  'Only use these categories: "outfit" (clothing, fit, wrinkles, tucking, layering, colour coordination, formality), "grooming" (hair, tidiness, overall put-togetherness), "accessories" (watch, belt, tie, jewellery, bag, glasses), "footwear" (shoes only, and only if visible). Camera angle, lighting, background and posture are measured separately by the device — do not comment on them.';

export interface VisionResult {
  findings: Finding[];
  unavailable: Unavailable[];
  summary: string;
}

interface RawFinding {
  category?: string;
  kind?: string;
  text?: string;
  confidence?: string;
  severity?: string;
  recommendation?: string;
  minutes?: number;
}

interface RawVision {
  visible?: { face?: boolean; top?: boolean; bottom?: boolean; shoes?: boolean; accessories?: boolean };
  findings?: RawFinding[];
  summary?: string;
}

const ALLOWED_CATEGORIES = new Set(['outfit', 'grooming', 'accessories', 'footwear']);
const ALLOWED_CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);
const ALLOWED_SEVERITY = new Set<Severity>(['critical', 'improve', 'polish']);

/**
 * Words that mean the model has drifted into judging a person rather than an
 * outfit. A finding containing one is dropped rather than shown, which is the
 * difference between asking a model to behave and making sure it did.
 */
const BODY_TALK =
  /\b(attractive|attractiveness|beautiful|handsome|pretty|ugly|good[- ]looking|slim|slender|fat|overweight|chubby|skinny|thin frame|body shape|physique|figure|complexion|blemish|acne|wrinkled skin|double chin|jawline|facial features|body type)\b/i;

export async function analyzeAppearance(args: {
  ctx: CheckContext;
  imageBase64: string;
  mediaType: string;
  /** What the on-device model could see, so the vision model is not asked to guess. */
  coverage: 'head' | 'upper' | 'knees' | 'full' | 'none';
  signal?: AbortSignal;
}): Promise<VisionResult> {
  const { ctx, imageBase64, mediaType, coverage } = args;
  const profile = getEvent(ctx.eventId);
  const online = isOnline(ctx);

  const context = [
    `Occasion: ${eventName(ctx)}${ctx.eventId === 'custom' && ctx.customEvent ? '' : ` (${profile.label})`}`,
    `Format: ${online ? 'ONLINE — the other person only ever sees what a webcam sees' : 'IN PERSON — the whole outfit will be seen, head to feet'}`,
    ctx.answers.formality && ctx.answers.formality !== 'unsure' ? `Stated formality: ${ctx.answers.formality}` : null,
    ctx.answers.dresscode ? `Stated dress code: ${ctx.answers.dresscode}` : null,
    ctx.answers.role ? `Role / subject: ${ctx.answers.role}` : null,
    ctx.answers.company ? `Organisation: ${ctx.answers.company}` : null,
    ctx.answers.interviewer ? `Interviewer: ${ctx.answers.interviewer}` : null,
    ctx.answers.setting ? `Setting: ${ctx.answers.setting}` : null,
    ctx.answers.timeOfDay ? `Time of day: ${ctx.answers.timeOfDay}` : null,
    ctx.answers.vibe ? `Type: ${ctx.answers.vibe}` : null,
    ctx.answers.venue ? `Venue: ${ctx.answers.venue}` : null,
    ctx.answers.occasion ? `Occasion detail: ${ctx.answers.occasion}` : null,
    ctx.customEvent ? `The person described it as: "${ctx.customEvent}"` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const coverageNote = {
    none: 'The body model could not find a person. Report only what you can genuinely see.',
    head: 'Only the head and shoulders are in frame. Do not comment on anything below the shoulders.',
    upper: 'The upper body is in frame. Do not comment on trousers, skirts or shoes.',
    knees: 'The body is in frame down to roughly the knees. Shoes are NOT visible — do not comment on footwear.',
    full: 'The full body including feet is in frame.',
  }[coverage];

  const system = [
    HOUSE_RULES,
    '',
    'What matters for THIS occasion:',
    ...profile.rubric.map((r) => `- ${r}`),
    online
      ? '- This is a video call. Footwear and lower-body clothing are irrelevant and must not be scored or mentioned.'
      : '- This is in person. The whole outfit reads, including how the shoes relate to everything above them.',
    '',
    CATEGORY_RULE,
    '',
    `Frame coverage: ${coverageNote}`,
    '',
    'Return ONLY minified JSON in this exact shape:',
    '{"visible":{"face":bool,"top":bool,"bottom":bool,"shoes":bool},"findings":[{"category":"outfit|grooming|accessories|footwear","kind":"observed|inferred","text":"what is the case, no advice","confidence":"high|medium|low","severity":"critical|improve|polish|none","recommendation":"imperative action, or empty when severity is none","minutes":number}],"summary":"one encouraging sentence"}',
    'Use severity "none" for things that are RIGHT — include two or three of those when they are true. Aim for 4 to 8 findings total. "critical" is reserved for something that would genuinely undermine the person at this specific occasion.',
  ].join('\n');

  const text = await callClaude(
    system,
    [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: `${context}\n\nAssess the person in the image for this occasion.` },
    ],
    1500,
    args.signal,
  );

  const raw = extractJson<RawVision>(text);
  return normaliseVision(raw, coverage, online);
}

/**
 * The enforcement pass.
 *
 * Exported so the guarantees can be tested directly against hostile model
 * output — a prompt is a request, and this is the part that makes it a rule.
 */
export function normaliseVision(raw: RawVision, coverage: string, online: boolean): VisionResult {
  const findings: Finding[] = [];
  let n = 0;

  for (const f of raw.findings ?? []) {
    const category = String(f.category ?? '').toLowerCase();
    if (!ALLOWED_CATEGORIES.has(category)) continue;
    const text = String(f.text ?? '').trim();
    if (!text) continue;
    // Rule 1, enforced rather than requested.
    if (BODY_TALK.test(text) || BODY_TALK.test(String(f.recommendation ?? ''))) continue;
    // Rule 2, enforced: nothing about shoes when there are no shoes in frame.
    if (category === 'footwear' && (online || coverage !== 'full')) continue;

    const severityRaw = String(f.severity ?? 'none').toLowerCase();
    const severity = ALLOWED_SEVERITY.has(severityRaw as Severity) ? (severityRaw as Severity) : undefined;
    const confidenceRaw = String(f.confidence ?? 'medium').toLowerCase() as Confidence;
    const recommendation = String(f.recommendation ?? '').trim();

    findings.push({
      id: `ai-${(n += 1)}`,
      category: category as Finding['category'],
      kind: f.kind === 'inferred' ? 'inferred' : 'observed',
      source: 'model',
      text,
      confidence: ALLOWED_CONFIDENCE.has(confidenceRaw) ? confidenceRaw : 'medium',
      // A criticism with no action attached is not useful, so it is downgraded
      // to an observation rather than silently costing points.
      severity: severity && recommendation ? severity : undefined,
      recommendation: recommendation || undefined,
      minutes: typeof f.minutes === 'number' && f.minutes > 0 ? Math.round(f.minutes) : undefined,
    });
  }

  const unavailable: Unavailable[] = [];
  const visible = raw.visible ?? {};
  if (!online && coverage === 'full' && visible.shoes === false) {
    unavailable.push({ category: 'footwear', reason: 'Shoes could not be made out clearly — footwear was left out of the score.' });
  }
  if (visible.face === false) {
    unavailable.push({ category: 'grooming', reason: 'Your face is not clearly visible in the frame, so grooming was not judged.' });
  }
  if (!findings.some((f) => f.category === 'accessories')) {
    // Silence about accessories means "nothing stood out", not "none exist".
    unavailable.push({
      category: 'accessories',
      reason: 'Nothing identifiable enough to judge — accessories were left out rather than guessed at.',
    });
  }

  return { findings, unavailable, summary: String(raw.summary ?? '').trim() };
}

// ---------------------------------------------------------------------------
// Preparation + mock interview
// ---------------------------------------------------------------------------

export interface PrepPack {
  likelyQuestions: { question: string; why: string }[];
  askThem: string[];
  topics: string[];
  talkingPoints: string[];
  mistakes: string[];
  /** The 3–5 questions the mock interview will actually ask. */
  mockQuestions: string[];
  source: 'model' | 'bank';
}

export async function generatePrep(ctx: CheckContext, signal?: AbortSignal): Promise<PrepPack> {
  const profile = getEvent(ctx.eventId);
  const a = ctx.answers;
  const detail = [
    `Occasion: ${eventName(ctx)}`,
    a.role ? `Role or subject: ${a.role}` : null,
    a.company ? `Organisation: ${a.company}` : null,
    a.interviewer ? `Interviewer type: ${a.interviewer}` : null,
    a.interviewType ? `Interview type: ${a.interviewType}` : null,
    a.experience ? `Experience level: ${a.experience}` : null,
    a.audience ? `Audience: ${a.audience}` : null,
    a.duration ? `Length: ${a.duration} minutes` : null,
    isOnline(ctx) ? 'Format: video call' : 'Format: in person',
    `Time before it starts: ${a.timeLeft === '999' ? 'plenty' : `${a.timeLeft ?? '15'} minutes`}`,
  ]
    .filter(Boolean)
    .join('\n');

  const system = [
    'You prepare people for something happening very soon. Everything you write must be usable in the next fifteen minutes.',
    'Be specific to the details given. If you are told the role is "Marketing Intern at a food delivery company", the questions must sound like that interview, not like a generic careers page.',
    'Never invent facts about the organisation. Where you would need knowledge you do not have, ask a question that makes the person recall it themselves.',
    profile.practice
      ? 'Also choose the questions for a short 2-minute mock interview: 4 of them, opening with a warm one and building. They should suit this exact interview.'
      : 'Also choose 3 short reflection prompts the person can rehearse out loud.',
    'Return ONLY minified JSON: {"likelyQuestions":[{"question":"...","why":"one short line on why this one comes up"}],"askThem":["..."],"topics":["..."],"talkingPoints":["..."],"mistakes":["..."],"mockQuestions":["..."]}',
    'Give 5 likelyQuestions, 3 askThem, 4 topics, 4 talkingPoints, 3 mistakes, 4 mockQuestions. Keep every string under 22 words.',
  ].join('\n');

  const text = await callClaude(system, [{ type: 'text', text: detail }], 1600, signal);
  const raw = extractJson<Partial<PrepPack>>(text);

  const strings = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).slice(0, max).map((s) => String(s).trim()) : [];

  return {
    likelyQuestions: Array.isArray(raw.likelyQuestions)
      ? raw.likelyQuestions
          .filter((q) => q && typeof q.question === 'string')
          .slice(0, 6)
          .map((q) => ({ question: String(q.question).trim(), why: String(q.why ?? '').trim() }))
      : [],
    askThem: strings(raw.askThem, 4),
    topics: strings(raw.topics, 5),
    talkingPoints: strings(raw.talkingPoints, 5),
    mistakes: strings(raw.mistakes, 4),
    mockQuestions: strings(raw.mockQuestions, 5),
    source: 'model',
  };
}

export interface InterviewTurn {
  question: string;
  answer: string;
  /** Seconds of speech, measured on the device. */
  seconds: number;
}

export interface ContentReview {
  strengths: string[];
  improvements: string[];
  biggest: string;
  practiceAgain: string;
  /** 0–10, the model's read on substance only. Delivery is measured on-device. */
  substance: number;
  perQuestion: { question: string; note: string }[];
  source: 'model' | 'heuristic';
}

export async function reviewInterview(
  ctx: CheckContext,
  turns: InterviewTurn[],
  signal?: AbortSignal,
): Promise<ContentReview> {
  const a = ctx.answers;
  const transcript = turns
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1} (${Math.round(t.seconds)}s): ${t.answer || '(no answer captured)'}`)
    .join('\n\n');

  const system = [
    'You review a short mock interview answer by answer. You are a coach, not a judge.',
    `Context: ${eventName(ctx)}${a.role ? `, role: ${a.role}` : ''}${a.company ? ` at ${a.company}` : ''}${a.interviewType ? `, ${a.interviewType} interview` : ''}${a.experience ? `, ${a.experience} level` : ''}.`,
    'Judge SUBSTANCE only: did the answer address the question, was it structured, was there a concrete example, was the result or impact clear, was it the right length.',
    'Do NOT comment on pace, filler words, eye contact, volume or posture — those are measured separately and you cannot hear or see this person.',
    'The transcript comes from automatic speech recognition and will contain errors. Never criticise wording that is obviously a transcription artefact.',
    'For behavioural questions, note where a situation-action-result shape would have helped — but do not force that structure onto questions that do not need it.',
    'Be encouraging and concrete. Name the single most valuable change.',
    'Return ONLY minified JSON: {"strengths":["..."],"improvements":["..."],"biggest":"one sentence","practiceAgain":"the exact question worth redoing","substance":0-10,"perQuestion":[{"question":"...","note":"one line"}]}',
    'Give 2–3 strengths and 2–3 improvements. Keep strings under 20 words.',
  ].join('\n');

  const text = await callClaude(system, [{ type: 'text', text: transcript }], 1200, signal);
  const raw = extractJson<Partial<ContentReview>>(text);

  const strings = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).slice(0, max).map((s) => String(s).trim()) : [];

  return {
    strengths: strings(raw.strengths, 3),
    improvements: strings(raw.improvements, 3),
    biggest: String(raw.biggest ?? '').trim(),
    practiceAgain: String(raw.practiceAgain ?? '').trim(),
    substance: typeof raw.substance === 'number' ? Math.max(0, Math.min(10, raw.substance)) : 7,
    perQuestion: Array.isArray(raw.perQuestion)
      ? raw.perQuestion
          .filter((p) => p && typeof p.question === 'string')
          .slice(0, 6)
          .map((p) => ({ question: String(p.question).trim(), note: String(p.note ?? '').trim() }))
      : [],
    source: 'model',
  };
}
