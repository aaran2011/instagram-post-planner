/**
 * The vocabulary the whole product shares.
 *
 * Everything downstream — the camera stage, the API routes, the score screens —
 * speaks in these types. The rule that keeps the product honest lives here in
 * the type system: a finding always carries WHERE it came from (`source`), HOW
 * sure we are (`confidence`), and WHETHER it was seen or guessed (`kind`).
 * Nothing can enter the score without answering those three questions.
 */

export type EventId =
  | 'job-interview'
  | 'online-interview'
  | 'academic-interview'
  | 'business-meeting'
  | 'presentation'
  | 'wedding'
  | 'party'
  | 'date'
  | 'dinner'
  | 'family-function'
  | 'casual-outing'
  | 'travel'
  | 'custom';

export type Depth = 'quick' | 'deep';

export type CategoryId =
  | 'outfit'
  | 'grooming'
  | 'accessories'
  | 'footwear'
  | 'posture'
  | 'camera'
  | 'lighting'
  | 'background'
  | 'preparation'
  | 'communication';

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  outfit: 'Outfit',
  grooming: 'Grooming',
  accessories: 'Accessories',
  footwear: 'Footwear',
  posture: 'Posture',
  camera: 'Camera',
  lighting: 'Lighting',
  background: 'Background',
  preparation: 'Preparation',
  communication: 'Communication',
};

/** What each category is actually judging, in one line, for the UI. */
export const CATEGORY_BLURBS: Record<CategoryId, string> = {
  outfit: 'Fit, neatness, colour coordination and how well it suits the occasion.',
  grooming: 'Hair, tidiness and overall put-togetherness — never attractiveness.',
  accessories: 'Watch, belt, tie, jewellery, bag — balance rather than quantity.',
  footwear: 'Whether shoes match the formality of everything above them.',
  posture: 'How you are holding yourself: shoulders, spine, head position.',
  camera: 'Height, distance and framing of the device pointed at you.',
  lighting: 'Whether your face reads clearly, and where the light is coming from.',
  background: 'What is behind you and how much it competes for attention.',
  preparation: 'How ready you are for the substance, not just the surface.',
  communication: 'Clarity, pace, structure and delivery while you speak.',
};

export type Confidence = 'high' | 'medium' | 'low';

/** 🔴 fix now · 🟡 improve · 🟢 optional polish */
export type Severity = 'critical' | 'improve' | 'polish';

export const SEVERITY_META: Record<Severity, { label: string; dot: string; tone: 'danger' | 'warn' | 'ok' }> = {
  critical: { label: 'Fix now', dot: '●', tone: 'danger' },
  improve: { label: 'Improve', dot: '●', tone: 'warn' },
  polish: { label: 'Optional', dot: '●', tone: 'ok' },
};

/**
 * One thing we know (or believe) about the person in frame.
 *
 * `kind` is the safety valve from the product brief: "observed" is something
 * directly visible or measured, "inferred" is a contextual judgement. The UI
 * labels them differently and never presents the second as the first.
 */
export interface Finding {
  id: string;
  category: CategoryId;
  kind: 'observed' | 'inferred';
  /**
   * Where it came from. `checklist` is the honest third option: something
   * worth checking that nothing has actually looked at — used in demo mode,
   * and never allowed to move a score.
   */
  source: 'device' | 'model' | 'checklist';
  /** Plain statement of what is the case. No advice in here. */
  text: string;
  confidence: Confidence;
  /** Present when this finding costs points; absent for strengths. */
  severity?: Severity;
  /** The advice that follows from it. Always phrased as an action. */
  recommendation?: string;
  /** Realistic minutes to act on it. */
  minutes?: number;
}

/** A category that could not be judged, and the honest reason why. */
export interface Unavailable {
  category: CategoryId;
  reason: string;
}

export interface CategoryScore {
  id: CategoryId;
  label: string;
  /** 0–10, one decimal. */
  score: number;
  /** Relative weight for this event, before renormalisation. */
  weight: number;
  findings: Finding[];
  /** True when at least one contributing finding was low confidence. */
  lowConfidence: boolean;
}

export interface Fix {
  id: string;
  category: CategoryId;
  /** Imperative and specific: "Tuck in your shirt", not "consider tucking". */
  title: string;
  detail?: string;
  severity: Severity;
  minutes: number;
  /** Points on the 0–10 overall scale this fix is expected to return. */
  impact: number;
}

/** Snapshot of the on-device measurements taken with the frame. */
export interface DeviceMetrics {
  framing: FramingMetrics | null;
  image: ImageMetrics | null;
}

export interface FramingMetrics {
  /** Model actually ran and found a person. */
  personDetected: boolean;
  /** Fraction of the frame height the body occupies, 0–1. */
  bodyFill: number;
  headVisible: boolean;
  torsoVisible: boolean;
  kneesVisible: boolean;
  feetVisible: boolean;
  /** Vertical position of the eye line, 0 = top of frame, 1 = bottom. */
  eyeLine: number;
  /** Horizontal centre of the body, 0–1. 0.5 is centred. */
  centerX: number;
  /** Positive = camera is below eye level (looking up at you). Degrees, approx. */
  cameraPitch: number;
  /** Head turn away from the lens in degrees, approximate. */
  headYaw: number;
  /** Shoulder tilt in degrees; 0 is level. */
  shoulderTilt: number;
  /** Forward head / slouch proxy, 0–1 where higher is more slouched. */
  slouch: number;
  /** Mean landmark visibility, used as a confidence signal. */
  quality: number;
}

export interface ImageMetrics {
  /** Mean luma 0–1 over the whole frame. */
  brightness: number;
  /** Mean luma of the face region, when a face box is known. */
  faceBrightness: number | null;
  /** faceBrightness − background brightness. Strongly negative = backlit. */
  faceVsBackground: number | null;
  /** Left-vs-right face luma difference, 0–1. High = side-lit. */
  faceSideDelta: number | null;
  /** Warm/cool cast: >0 warm (tungsten), <0 cool (daylight/screen). */
  colorTemp: number;
  /** Fraction of pixels blown out to pure white. */
  clipped: number;
  /** Edge density behind the person, 0–1. Higher = busier background. */
  backgroundBusyness: number;
  /** Standard deviation of luma — very low means a flat, murky frame. */
  contrast: number;
}

/** Answers to the event questions, keyed by question id. */
export type Answers = Record<string, string>;

export interface CheckContext {
  eventId: EventId;
  /** Free text when eventId === 'custom'. */
  customEvent?: string;
  depth: Depth;
  answers: Answers;
}

export interface AppearanceReport {
  categories: CategoryScore[];
  unavailable: Unavailable[];
  /** 0–10, one decimal. */
  overall: number;
  fixes: Fix[];
  strengths: Finding[];
  /** True when no model has looked at the frame and this is measurement-only. */
  demo: boolean;
  /** Set when the vision model was unreachable and we fell back. */
  degraded?: string;
  /** Things worth checking yourself, when nothing could look at them for you. */
  checklist: Finding[];
  /** True when the outfit itself was never assessed, so the score covers setup only. */
  appearanceScored: boolean;
  /**
   * Too little was actually assessed for the number to mean anything. The UI
   * hides the score entirely rather than showing a confident figure built from
   * two incidental measurements — and says which of the two reasons it was,
   * because "stand where we can see you" and "no model is connected" call for
   * completely different responses from the user.
   */
  inconclusive: false | 'no-person' | 'nothing-scored';
}

export type ReadyState = 'ready' | 'almost' | 'not-ready';

export interface ReadinessBucket {
  id: string;
  label: string;
  /** 0–100. */
  score: number;
  detail: string;
}

export interface ReadinessReport {
  /** 0–100. Meaningless, and not shown, when `inconclusive` is true. */
  score: number;
  state: ReadyState;
  /**
   * Nothing of substance was assessed — the appearance check came back
   * inconclusive and no interview or preparation stage filled the gap. The
   * final screen refuses to show a number rather than presenting a posture
   * reading as a readiness verdict.
   */
  inconclusive: boolean;
  buckets: ReadinessBucket[];
  doNow: Fix[];
  closing: string;
}
