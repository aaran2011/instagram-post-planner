/**
 * The Context Engine.
 *
 * One rubric for every occasion is what makes appearance apps useless: a
 * checker that docks you for trainers when you are on a video call, where your
 * feet are two metres out of frame, is not checking anything. So the event
 * decides three things before a single pixel is looked at:
 *
 *   1. which questions are worth asking (and which are noise),
 *   2. which categories are scored at all, and how heavily,
 *   3. what "appropriate" even means here, in words the vision model gets.
 *
 * Adding a new occasion means adding one entry to EVENTS. Nothing else in the
 * app needs to know it exists.
 */

import type { Answers, CategoryId, CheckContext, EventId } from './types';

export type QuestionKind = 'choice' | 'text' | 'chips';

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  id: string;
  kind: QuestionKind;
  /** Asked as a person would ask it. */
  prompt: string;
  /** Small print under the prompt, when the answer needs framing. */
  help?: string;
  options?: Option[];
  placeholder?: string;
  /** Skippable questions never block the flow. */
  optional?: boolean;
  /** Progressive disclosure: only asked when this returns true. */
  when?: (a: Answers) => boolean;
  /** Quick Check asks only the questions marked essential. */
  essential?: boolean;
}

export interface EventProfile {
  id: EventId;
  label: string;
  /** Two-word promise of what this check is about. */
  tagline: string;
  group: 'work' | 'occasion' | 'social';
  /** Key into the icon set. */
  icon: string;
  /** Category weights before any renormalisation. 0 means "not judged here". */
  weights: Partial<Record<CategoryId, number>>;
  /** Extra questions on top of the shared ones. */
  questions: Question[];
  /** Fed to the vision model so "appropriate" means the right thing. */
  rubric: string[];
  /** Whether the practice/mock-interview stage is offered. */
  practice: boolean;
  /** Whether a preparation stage (topics, questions, talking points) applies. */
  prep: boolean;
}

const TIME_OPTIONS: Option[] = [
  { value: '2', label: '2 minutes', hint: 'Leaving right now' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '999', label: 'Plenty of time' },
];

/** Asked for every event, in this order, before the event's own questions. */
export const SHARED_QUESTIONS: Question[] = [
  {
    id: 'modality',
    kind: 'choice',
    prompt: 'Is this online or in person?',
    help: 'This changes what actually gets scored.',
    essential: true,
    options: [
      { value: 'in-person', label: 'In person', hint: 'Whole outfit counts' },
      { value: 'online', label: 'Online', hint: 'Camera, light and background count' },
    ],
  },
  {
    id: 'setting',
    kind: 'choice',
    prompt: 'Indoors or outdoors?',
    optional: true,
    when: (a) => a.modality !== 'online',
    options: [
      { value: 'indoor', label: 'Indoors' },
      { value: 'outdoor', label: 'Outdoors' },
      { value: 'both', label: 'A bit of both' },
    ],
  },
  {
    id: 'timeOfDay',
    kind: 'choice',
    prompt: 'Day or evening?',
    optional: true,
    options: [
      { value: 'day', label: 'Daytime' },
      { value: 'evening', label: 'Evening' },
      { value: 'night', label: 'Night' },
    ],
  },
  {
    id: 'formality',
    kind: 'choice',
    prompt: 'How formal is it?',
    essential: true,
    options: [
      { value: 'casual', label: 'Casual' },
      { value: 'smart-casual', label: 'Smart casual' },
      { value: 'business', label: 'Business' },
      { value: 'formal', label: 'Formal' },
      { value: 'unsure', label: "I'm not sure", hint: "We'll infer it from the event" },
    ],
  },
  {
    id: 'dresscode',
    kind: 'text',
    prompt: 'Any stated dress code?',
    help: 'Type it as it was given to you — we grade against it.',
    placeholder: 'e.g. black tie, no jeans, traditional',
    optional: true,
    when: (a) => a.formality === 'formal' || a.formality === 'business',
  },
  {
    id: 'timeLeft',
    kind: 'choice',
    prompt: 'How much time do you have before you leave?',
    help: 'We only suggest fixes you can actually finish in that time.',
    essential: true,
    options: TIME_OPTIONS,
  },
];

const INTERVIEW_QUESTIONS: Question[] = [
  {
    id: 'role',
    kind: 'text',
    prompt: 'What role are you interviewing for?',
    placeholder: 'e.g. Marketing Intern',
    essential: true,
  },
  {
    id: 'company',
    kind: 'text',
    prompt: 'Which company or organisation?',
    placeholder: 'e.g. Zomato',
    optional: true,
  },
  {
    id: 'interviewer',
    kind: 'choice',
    prompt: 'Who is interviewing you?',
    options: [
      { value: 'hr', label: 'HR' },
      { value: 'manager', label: 'Hiring manager' },
      { value: 'founder', label: 'Founder' },
      { value: 'recruiter', label: 'Recruiter' },
      { value: 'ca', label: 'CA / finance partner' },
      { value: 'professor', label: 'Professor' },
      { value: 'panel', label: 'A panel' },
    ],
  },
  {
    id: 'interviewType',
    kind: 'choice',
    prompt: 'What kind of interview?',
    options: [
      { value: 'hr', label: 'HR / screening' },
      { value: 'technical', label: 'Technical' },
      { value: 'behavioral', label: 'Behavioural' },
      { value: 'general', label: 'General' },
    ],
  },
  {
    id: 'experience',
    kind: 'choice',
    prompt: 'Where are you in your career?',
    options: [
      { value: 'student', label: 'Student' },
      { value: 'fresher', label: 'First job' },
      { value: 'mid', label: '2–6 years' },
      { value: 'senior', label: '7+ years' },
    ],
  },
];

/**
 * Weights are on a 0–5 scale and only ever compared against each other, so
 * "5 here and 1 there" is the whole statement. Anything set to 0 is not shown,
 * not scored, and not mentioned.
 */
export const EVENTS: EventProfile[] = [
  {
    id: 'job-interview',
    label: 'Job Interview',
    tagline: 'In the room',
    group: 'work',
    icon: 'briefcase',
    weights: {
      outfit: 5,
      grooming: 5,
      footwear: 4,
      accessories: 2,
      posture: 4,
      camera: 1,
      lighting: 1,
      background: 1,
      preparation: 5,
      communication: 5,
    },
    questions: INTERVIEW_QUESTIONS,
    rubric: [
      'Formality should read at least business-casual; err towards the more conservative option.',
      'Shoes matter: they should be at least as formal as the rest of the outfit and look cared for.',
      'Fit and neatness beat expense — a pressed inexpensive shirt outranks a rumpled expensive one.',
      'Loud logos, novelty prints and heavy fragrance-adjacent styling are risks in a first meeting.',
    ],
    practice: true,
    prep: true,
  },
  {
    id: 'online-interview',
    label: 'Online Interview',
    tagline: 'Through a lens',
    group: 'work',
    icon: 'video',
    weights: {
      outfit: 4,
      grooming: 5,
      footwear: 0,
      accessories: 1,
      posture: 4,
      camera: 5,
      lighting: 5,
      background: 4,
      preparation: 5,
      communication: 5,
    },
    questions: INTERVIEW_QUESTIONS,
    rubric: [
      'Only what the webcam sees counts: collar, shoulders, upper torso, hair, and the room behind.',
      'Never comment on shoes or lower-body clothing — they are out of frame and irrelevant here.',
      'Fine stripes and dense patterns shimmer on video compression; solid mid-tones read best.',
      'A clean, uncluttered background and a face that is clearly lit matter more than the garment itself.',
    ],
    practice: true,
    prep: true,
  },
  {
    id: 'academic-interview',
    label: 'School / College Interview',
    tagline: 'Making the case',
    group: 'work',
    icon: 'cap',
    weights: {
      outfit: 4,
      grooming: 5,
      footwear: 3,
      accessories: 1,
      posture: 4,
      camera: 2,
      lighting: 2,
      background: 2,
      preparation: 5,
      communication: 5,
    },
    questions: [
      {
        id: 'role',
        kind: 'text',
        prompt: 'What are you applying for?',
        placeholder: 'e.g. B.Sc. Economics',
        essential: true,
      },
      { id: 'company', kind: 'text', prompt: 'Which institution?', placeholder: 'e.g. St. Xavier’s', optional: true },
      {
        id: 'interviewer',
        kind: 'choice',
        prompt: 'Who will you be speaking to?',
        options: [
          { value: 'professor', label: 'Professor' },
          { value: 'panel', label: 'Admissions panel' },
          { value: 'alumni', label: 'Alumni interviewer' },
          { value: 'counsellor', label: 'Counsellor' },
        ],
      },
      {
        id: 'experience',
        kind: 'choice',
        prompt: 'What stage are you at?',
        options: [
          { value: 'school', label: 'School student' },
          { value: 'undergrad', label: 'Undergraduate' },
          { value: 'postgrad', label: 'Postgraduate' },
        ],
      },
    ],
    rubric: [
      'Smart and tidy, not corporate. A blazer is welcome but a full suit can read as trying too hard.',
      'Neatness and legibility matter more than formality level at this age and stage.',
    ],
    practice: true,
    prep: true,
  },
  {
    id: 'business-meeting',
    label: 'Business Meeting',
    tagline: 'Taken seriously',
    group: 'work',
    icon: 'handshake',
    weights: {
      outfit: 4,
      grooming: 4,
      footwear: 3,
      accessories: 2,
      posture: 3,
      camera: 2,
      lighting: 2,
      background: 2,
      preparation: 3,
      communication: 3,
    },
    questions: [
      { id: 'role', kind: 'text', prompt: 'What is the meeting about?', placeholder: 'e.g. client pitch', optional: true },
      {
        id: 'audience',
        kind: 'choice',
        prompt: 'Who is in the room?',
        options: [
          { value: 'client', label: 'A client' },
          { value: 'internal', label: 'Internal team' },
          { value: 'investor', label: 'Investors' },
          { value: 'vendor', label: 'Partners / vendors' },
        ],
      },
    ],
    rubric: [
      'Match the room: client-facing skews a notch more formal than internal.',
      'Consistency across the outfit matters more than any single item.',
    ],
    practice: false,
    prep: true,
  },
  {
    id: 'presentation',
    label: 'Presentation',
    tagline: 'All eyes up',
    group: 'work',
    icon: 'podium',
    weights: {
      outfit: 4,
      grooming: 4,
      footwear: 2,
      accessories: 2,
      posture: 5,
      camera: 3,
      lighting: 3,
      background: 3,
      preparation: 5,
      communication: 5,
    },
    questions: [
      { id: 'role', kind: 'text', prompt: 'What are you presenting?', placeholder: 'e.g. Q3 results', essential: true },
      {
        id: 'audience',
        kind: 'choice',
        prompt: 'Who is the audience?',
        options: [
          { value: 'colleagues', label: 'Colleagues' },
          { value: 'leadership', label: 'Leadership' },
          { value: 'clients', label: 'Clients' },
          { value: 'public', label: 'A public audience' },
          { value: 'class', label: 'A class' },
        ],
      },
      {
        id: 'duration',
        kind: 'choice',
        prompt: 'How long do you have?',
        optional: true,
        options: [
          { value: '5', label: '5 min' },
          { value: '10', label: '10 min' },
          { value: '20', label: '20 min' },
          { value: '45', label: '45 min+' },
        ],
      },
    ],
    rubric: [
      'Standing changes things: check hems, tucking and whether anything rides up when arms are raised.',
      'Very fine patterns and bright white can flare under stage lighting or on camera.',
      'Posture and stillness carry more of the impression than the garment does.',
    ],
    practice: true,
    prep: true,
  },
  {
    id: 'wedding',
    label: 'Wedding',
    tagline: 'Dressed for it',
    group: 'occasion',
    icon: 'rings',
    weights: {
      outfit: 5,
      grooming: 5,
      footwear: 4,
      accessories: 4,
      posture: 2,
      camera: 0,
      lighting: 0,
      background: 0,
      preparation: 1,
      communication: 0,
    },
    questions: [
      {
        id: 'role',
        kind: 'choice',
        prompt: 'What is your part in the day?',
        essential: true,
        options: [
          { value: 'guest', label: 'Guest' },
          { value: 'family', label: 'Close family' },
          { value: 'party', label: 'Wedding party' },
          { value: 'couple', label: 'Getting married' },
        ],
      },
      {
        id: 'ceremony',
        kind: 'choice',
        prompt: 'What kind of ceremony?',
        optional: true,
        options: [
          { value: 'traditional', label: 'Traditional' },
          { value: 'western', label: 'Western / white wedding' },
          { value: 'mixed', label: 'Mixed' },
          { value: 'reception', label: 'Reception only' },
        ],
      },
    ],
    rubric: [
      'Colour coordination and accessory balance carry the most weight here.',
      'Guests should avoid competing with the couple — flag all-white for western ceremonies, and note when an outfit reads more bridal than guest.',
      'Footwear should match the formality of the outfit and suit the floor it will stand on all evening.',
      'Being slightly under-dressed is a real risk at weddings; say so plainly when it applies.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'party',
    label: 'Party',
    tagline: 'Room-ready',
    group: 'social',
    icon: 'sparkle',
    weights: {
      outfit: 5,
      grooming: 4,
      footwear: 3,
      accessories: 3,
      posture: 1,
      camera: 0,
      lighting: 0,
      background: 0,
      preparation: 0,
      communication: 0,
    },
    questions: [
      {
        id: 'vibe',
        kind: 'choice',
        prompt: 'What kind of party?',
        essential: true,
        options: [
          { value: 'house', label: 'House party' },
          { value: 'club', label: 'Club / night out' },
          { value: 'birthday', label: 'Birthday' },
          { value: 'work', label: 'Work party' },
          { value: 'festive', label: 'Festive / seasonal' },
        ],
      },
    ],
    rubric: [
      'Cohesion and confidence matter more than formality. Do not push someone towards conservative dressing here.',
      'Work parties are the exception: they still sit inside professional judgement.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'date',
    label: 'Date',
    tagline: 'Comfortably sharp',
    group: 'social',
    icon: 'heart',
    weights: {
      outfit: 5,
      grooming: 5,
      footwear: 3,
      accessories: 2,
      posture: 2,
      camera: 0,
      lighting: 0,
      background: 0,
      preparation: 0,
      communication: 0,
    },
    questions: [
      {
        id: 'vibe',
        kind: 'choice',
        prompt: 'What are you doing?',
        essential: true,
        options: [
          { value: 'coffee', label: 'Coffee / walk' },
          { value: 'dinner', label: 'Dinner' },
          { value: 'activity', label: 'An activity' },
          { value: 'drinks', label: 'Drinks' },
        ],
      },
      {
        id: 'familiarity',
        kind: 'choice',
        prompt: 'First time meeting?',
        optional: true,
        options: [
          { value: 'first', label: 'First date' },
          { value: 'few', label: 'A few dates in' },
          { value: 'together', label: 'Together a while' },
        ],
      },
    ],
    rubric: [
      'Aim for well-put-together and comfortable. Never comment on how attractive anyone looks.',
      'Grooming and neatness are the whole game; formality barely registers.',
      'If the outfit already works, say so and stop.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'dinner',
    label: 'Dinner',
    tagline: 'Right register',
    group: 'social',
    icon: 'plate',
    weights: {
      outfit: 4,
      grooming: 4,
      footwear: 3,
      accessories: 2,
      posture: 1,
      preparation: 0,
      communication: 0,
    },
    questions: [
      {
        id: 'venue',
        kind: 'choice',
        prompt: 'Where is dinner?',
        essential: true,
        options: [
          { value: 'home', label: 'Someone’s home' },
          { value: 'restaurant', label: 'Restaurant' },
          { value: 'fine', label: 'Fine dining' },
          { value: 'work', label: 'Work dinner' },
        ],
      },
    ],
    rubric: ['Venue sets the bar. Fine dining and work dinners raise it; a friend’s table does not.'],
    practice: false,
    prep: false,
  },
  {
    id: 'family-function',
    label: 'Family Function',
    tagline: 'Respectfully sharp',
    group: 'occasion',
    icon: 'home',
    weights: {
      outfit: 5,
      grooming: 4,
      footwear: 3,
      accessories: 3,
      posture: 1,
      preparation: 0,
      communication: 0,
    },
    questions: [
      {
        id: 'occasion',
        kind: 'text',
        prompt: 'What is the occasion?',
        placeholder: 'e.g. engagement, puja, anniversary',
        essential: true,
      },
    ],
    rubric: [
      'Traditional and cultural dress is a first-class answer here — never treat it as less formal than a suit.',
      'Coordination and tidiness matter; be careful not to impose one culture’s formality ladder on another.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'casual-outing',
    label: 'Casual Outing',
    tagline: 'Effortless',
    group: 'social',
    icon: 'sun',
    weights: {
      outfit: 4,
      grooming: 3,
      footwear: 3,
      accessories: 2,
      posture: 1,
      preparation: 0,
      communication: 0,
    },
    questions: [
      {
        id: 'activity',
        kind: 'text',
        prompt: 'What are you heading out for?',
        placeholder: 'e.g. shopping with friends',
        optional: true,
      },
    ],
    rubric: [
      'Comfort and coordination only. Do not recommend formality.',
      'Weather-appropriateness is worth a mention when the setting answer implies outdoors.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'travel',
    label: 'Travel',
    tagline: 'Long-haul ready',
    group: 'occasion',
    icon: 'plane',
    weights: {
      outfit: 4,
      grooming: 3,
      footwear: 4,
      accessories: 2,
      posture: 1,
      preparation: 2,
      communication: 0,
    },
    questions: [
      {
        id: 'mode',
        kind: 'choice',
        prompt: 'How are you travelling?',
        essential: true,
        options: [
          { value: 'flight', label: 'Flight' },
          { value: 'train', label: 'Train' },
          { value: 'road', label: 'Road trip' },
          { value: 'work', label: 'Work trip' },
        ],
      },
      {
        id: 'duration',
        kind: 'choice',
        prompt: 'How long is the journey?',
        optional: true,
        options: [
          { value: 'short', label: 'Under 3 hours' },
          { value: 'medium', label: '3–8 hours' },
          { value: 'long', label: 'Overnight / long-haul' },
        ],
      },
    ],
    rubric: [
      'Judge comfort, layerability and practicality — not formality.',
      'Shoes that come off easily and layers for a cold cabin are genuine wins here.',
    ],
    practice: false,
    prep: false,
  },
  {
    id: 'custom',
    label: 'Something else',
    tagline: 'You name it',
    group: 'occasion',
    icon: 'star',
    weights: {
      outfit: 4,
      grooming: 4,
      footwear: 3,
      accessories: 2,
      posture: 2,
      camera: 1,
      lighting: 1,
      background: 1,
      preparation: 1,
      communication: 0,
    },
    questions: [
      {
        id: 'customDetail',
        kind: 'text',
        prompt: 'Tell us a bit more about it',
        placeholder: 'e.g. visa interview at the consulate',
        optional: true,
      },
    ],
    rubric: [
      'The user described the occasion in their own words. Take it literally and judge against it.',
      'When the description is too vague to judge formality, say so instead of assuming.',
    ],
    practice: false,
    prep: true,
  },
];

const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

export function getEvent(id: EventId): EventProfile {
  return BY_ID.get(id) ?? BY_ID.get('custom')!;
}

export function eventName(ctx: CheckContext): string {
  if (ctx.eventId === 'custom' && ctx.customEvent?.trim()) return ctx.customEvent.trim();
  return getEvent(ctx.eventId).label;
}

/** True for the two interview types plus anything the user flagged as online. */
export function isOnline(ctx: CheckContext): boolean {
  if (ctx.eventId === 'online-interview') return true;
  return ctx.answers.modality === 'online';
}

export function isInterview(ctx: CheckContext): boolean {
  return ctx.eventId === 'job-interview' || ctx.eventId === 'online-interview' || ctx.eventId === 'academic-interview';
}

/**
 * The questions this person actually gets asked.
 *
 * Quick Check keeps only the essentials; Deep Check asks everything whose
 * `when` guard passes against the answers so far. The guard is re-evaluated as
 * they answer, so choosing "online" removes the indoor/outdoor question before
 * they ever see it.
 */
export function questionsFor(ctx: CheckContext, rawAnswers: Answers = ctx.answers): Question[] {
  const profile = getEvent(ctx.eventId);
  const modalityFixed = ctx.eventId === 'online-interview' || profile.weights.camera === 0;

  // When the occasion already settles the format, the guards downstream still
  // need to know it — otherwise an online interview gets asked whether it is
  // happening indoors.
  const answers: Answers = modalityFixed
    ? { ...rawAnswers, modality: ctx.eventId === 'online-interview' ? 'online' : 'in-person' }
    : rawAnswers;

  const shared = SHARED_QUESTIONS.filter((q) => {
    if (q.id === 'modality' && modalityFixed) return false;
    if (q.id === 'formality' && (ctx.eventId === 'casual-outing' || ctx.eventId === 'travel')) return false;
    return true;
  });

  const all = [...shared.slice(0, 1), ...profile.questions, ...shared.slice(1)];

  return all.filter((q) => {
    if (q.when && !q.when(answers)) return false;
    if (ctx.depth === 'quick' && !q.essential) return false;
    return true;
  });
}

/**
 * Category weights for this specific check.
 *
 * The event sets the baseline; the answers bend it. Going online zeroes the
 * feet and raises the room, which is the single most important behaviour in
 * the whole product.
 */
export function weightsFor(ctx: CheckContext): Partial<Record<CategoryId, number>> {
  const base: Partial<Record<CategoryId, number>> = { ...getEvent(ctx.eventId).weights };

  if (isOnline(ctx)) {
    base.footwear = 0;
    base.camera = Math.max(base.camera ?? 0, 5);
    base.lighting = Math.max(base.lighting ?? 0, 5);
    base.background = Math.max(base.background ?? 0, 4);
    base.outfit = Math.min(base.outfit ?? 4, 4);
    base.accessories = Math.min(base.accessories ?? 2, 1);
  } else if ((base.camera ?? 0) > 0) {
    // In person, the phone in front of them is only a measuring instrument.
    base.camera = 1;
    base.lighting = 1;
    base.background = 0;
  }

  if (ctx.answers.formality === 'formal') {
    base.footwear = (base.footwear ?? 0) > 0 ? Math.max(base.footwear ?? 0, 4) : 0;
    base.accessories = Math.max(base.accessories ?? 0, 3);
  }
  if (ctx.answers.setting === 'outdoor') {
    base.background = 0;
  }
  return base;
}

/** The stage list shown in the progress rail, in order. */
export type Stage = 'event' | 'details' | 'camera' | 'analysis' | 'prepare' | 'practice' | 'result';

export function stagesFor(ctx: CheckContext): Stage[] {
  const profile = getEvent(ctx.eventId);
  const stages: Stage[] = ['event', 'details', 'camera', 'analysis'];
  if (ctx.depth === 'deep' && profile.prep) stages.push('prepare');
  if (ctx.depth === 'deep' && profile.practice) stages.push('practice');
  stages.push('result');
  return stages;
}

export const STAGE_LABELS: Record<Stage, string> = {
  event: 'Occasion',
  details: 'Details',
  camera: 'Look',
  analysis: 'Fix',
  prepare: 'Prepare',
  practice: 'Practice',
  result: 'Ready',
};

/** Minutes the user says they have. `999` is the "plenty of time" sentinel. */
export function timeBudget(answers: Answers): number {
  const raw = Number(answers.timeLeft ?? '15');
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}
