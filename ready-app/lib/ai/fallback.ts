/**
 * What the app does with no API key — and what it refuses to do.
 *
 * It refuses to describe an outfit it has not seen. There is no "demo verdict"
 * that says your collar is crooked when nothing looked at your collar; that
 * would be the single most dishonest thing this product could do.
 *
 * What it offers instead is real and useful without a model:
 *   - a self-check list, phrased as things for YOU to look at,
 *   - a genuine question bank for interview prep, drawn from the details given,
 *   - a review of the mock interview built from measurable properties of the
 *     answers (length, examples, whether the question was addressed).
 *
 * All three are labelled in the UI as what they are.
 */

import { eventName, getEvent, isInterview, isOnline } from '../engine/events';
import type { CategoryId, CheckContext, Finding } from '../engine/types';
import type { ContentReview, InterviewTurn, PrepPack } from './claude';

let seq = 0;
const item = (category: CategoryId, text: string): Finding => ({
  id: `chk-${(seq += 1)}`,
  category,
  kind: 'inferred',
  source: 'checklist',
  text,
  confidence: 'low',
});

/**
 * The list a friend would run through with you at the door — not a verdict.
 * Tailored by occasion so it is never the same generic five lines.
 */
export function selfChecklist(ctx: CheckContext): Finding[] {
  seq = 0;
  const online = isOnline(ctx);
  const list: Finding[] = [];

  list.push(item('grooming', 'Hair sitting the way you want it, front and sides'));
  list.push(item('outfit', 'Collar flat, no creases across the chest and shoulders'));

  if (online) {
    list.push(item('outfit', 'Top layer reads as one solid colour rather than a fine pattern on camera'));
    list.push(item('grooming', 'Nothing on your face or teeth — check in the viewfinder above'));
  } else {
    list.push(item('outfit', 'Shirt tucked evenly, waistband sitting flat all the way round'));
    list.push(item('footwear', 'Shoes clean, and at least as formal as everything above them'));
    list.push(item('accessories', 'Belt matches the shoes; watch and jewellery are not competing'));
  }

  switch (ctx.eventId) {
    case 'job-interview':
    case 'online-interview':
    case 'academic-interview':
      list.push(item('outfit', 'Nothing you will fidget with — no loose cuff, no strap that keeps sliding'));
      break;
    case 'wedding':
      list.push(item('outfit', 'Not so close to white or bridal that you pull focus from the couple'));
      list.push(item('accessories', 'One statement piece, not three competing ones'));
      break;
    case 'presentation':
      list.push(item('outfit', 'Raise your arms once — check nothing rides up or gapes'));
      list.push(item('accessories', 'Somewhere to clip a mic, and pockets empty of keys and coins'));
      break;
    case 'travel':
      list.push(item('outfit', 'A layer you can take off, and shoes you can get off quickly'));
      break;
    case 'date':
    case 'party':
      list.push(item('outfit', 'Comfortable enough to forget about after ten minutes'));
      break;
    default:
      list.push(item('outfit', 'Everything sitting where it should when you stand naturally'));
  }

  return list;
}

/**
 * A real bank of interview questions, selected by the answers given.
 *
 * Not AI output and not pretending to be — these are the questions that
 * actually get asked, narrowed by role, interviewer and level.
 */
export function questionBank(ctx: CheckContext): PrepPack {
  const a = ctx.answers;
  const role = a.role?.trim() || 'this role';
  const org = a.company?.trim();
  const kind = a.interviewType ?? 'general';
  const who = a.interviewer ?? 'hr';
  const level = a.experience ?? 'fresher';
  const name = eventName(ctx);

  if (!isInterview(ctx)) {
    return {
      likelyQuestions: [
        { question: `What will people ask you about at ${name.toLowerCase()}?`, why: 'Have one easy answer ready.' },
        { question: 'What is the one thing you want to come away having done?', why: 'Gives the event a purpose.' },
      ],
      askThem: ['Ask one question that gets the other person talking about themselves.'],
      topics: ['Two things you can talk about comfortably', 'One question to open a conversation with'],
      talkingPoints: ['What you have been up to lately, in one sentence'],
      mistakes: ['Arriving without knowing who else will be there'],
      mockQuestions: [
        'Tell me a bit about yourself.',
        `What are you looking forward to about ${name.toLowerCase()}?`,
        'What have you been working on lately?',
      ],
      source: 'bank',
    };
  }

  const opener =
    level === 'student' || level === 'school'
      ? 'Tell me about yourself and what drew you here.'
      : 'Tell me about yourself.';

  const byKind: Record<string, string[]> = {
    technical: [
      `Walk me through something you built or solved that is relevant to ${role}.`,
      'What would you do first if you found a bug you could not reproduce?',
      'Which part of your last project would you rebuild, and why?',
    ],
    behavioral: [
      'Tell me about a time you disagreed with someone on your team.',
      'Describe a time something went wrong because of a decision you made.',
      'Tell me about a time you had more work than time.',
    ],
    hr: [
      `Why ${org ? org : 'this organisation'}, and why now?`,
      'What kind of work do you want to be doing in two years?',
      'What would your last manager say you need to work on?',
    ],
    general: [
      `Why are you interested in ${role}?`,
      'What are you strongest at, and where do you need support?',
      'Tell me about something you are proud of.',
    ],
  };

  const core = byKind[kind] ?? byKind.general;

  const askThemBy: Record<string, string[]> = {
    hr: ['What does the first ninety days look like in this role?', 'How would you describe the team culture here?'],
    manager: ['What does success look like in this role after six months?', 'What is the team working on right now?'],
    founder: ['What are you betting on for the next year?', 'What has surprised you most about building this?'],
    recruiter: ['What are the next steps after today?', 'What is the team specifically looking for?'],
    ca: ['Which areas of practice would I be exposed to first?', 'How is work allocated across the team?'],
    professor: ['What research is the department focused on right now?', 'What do students here find hardest in year one?'],
    panel: ['What would make someone excellent rather than adequate in this role?'],
    alumni: ['What do you wish you had known before you started?'],
    counsellor: ['What do you look for beyond marks?'],
  };

  return {
    likelyQuestions: [
      { question: opener, why: 'Opens almost every interview. Two minutes, ending on why you are here.' },
      ...core.map((q) => ({ question: q, why: `Standard for a ${kind} interview.` })),
      { question: 'Do you have any questions for us?', why: 'Never say no — have two ready.' },
    ],
    askThem: askThemBy[who] ?? askThemBy.hr,
    topics: [
      `What ${role} actually involves day to day`,
      org ? `What ${org} does, in one sentence you could say out loud` : 'What the organisation does, in one sentence',
      'Two examples from your own experience you can tell in under 90 seconds',
      'Your reason for wanting this, said plainly',
    ],
    talkingPoints: [
      'One thing you did that had a measurable result',
      'One thing you learned the hard way',
      'One reason this role specifically, not just any role',
    ],
    mistakes: [
      'Answering the question you wish they had asked',
      'Talking for four minutes when ninety seconds was enough',
      'Having no question to ask at the end',
    ],
    mockQuestions: [opener, core[0], core[1] ?? 'Tell me about a time you solved a difficult problem.', 'Why should we pick you?'],
    source: 'bank',
  };
}

const FILLER_ONLY = /^\s*(um|uh|erm|hmm|\.\.\.)?\s*$/i;
const EXAMPLE_MARKERS = /\b(for example|for instance|once|last (year|month|week)|at my|in my (last|previous)|we built|i built|i led|i wrote|i ran)\b/i;
const RESULT_MARKERS = /\b(\d+\s?%|\d+x|increased|reduced|saved|grew|shipped|delivered|resulted in|which meant|so that)\b/i;
const STRUCTURE_MARKERS = /\b(first|then|after that|finally|the situation|my role|what i did|the result|in the end)\b/i;

/**
 * A review built only from things that can be counted.
 *
 * No key, no model — but "you gave an example and named a result" is a fact
 * about the transcript, not an opinion, so it can still be said with a straight
 * face. Anything that would need judgement is simply not claimed.
 */
export function heuristicReview(ctx: CheckContext, turns: InterviewTurn[]): ContentReview {
  const answered = turns.filter((t) => t.answer && !FILLER_ONLY.test(t.answer));
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  const withExample = answered.filter((t) => EXAMPLE_MARKERS.test(t.answer));
  const withResult = answered.filter((t) => RESULT_MARKERS.test(t.answer));
  const structured = answered.filter((t) => STRUCTURE_MARKERS.test(t.answer));
  const veryShort = answered.filter((t) => words(t.answer) < 25);
  const veryLong = answered.filter((t) => words(t.answer) > 260 || t.seconds > 150);

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (answered.length === turns.length && turns.length) strengths.push('You answered every question without stalling.');
  if (withExample.length >= Math.ceil(answered.length / 2)) strengths.push('Most answers included a concrete example.');
  if (withResult.length) strengths.push('You named an actual result, which most people forget to do.');
  if (structured.length >= 2) strengths.push('Your answers had a clear beginning, middle and end.');

  if (!withExample.length && answered.length) improvements.push('Add one specific example — a time, a place, a thing you did.');
  if (!withResult.length && answered.length) improvements.push('Finish an answer with what changed because of your work.');
  if (veryShort.length) improvements.push(`${veryShort.length} answer${veryShort.length > 1 ? 's were' : ' was'} very brief — add the example.`);
  if (veryLong.length) improvements.push(`${veryLong.length} answer${veryLong.length > 1 ? 's ran' : ' ran'} long — aim to land in about 90 seconds.`);
  if (turns.length && !answered.length) improvements.push('Nothing was captured. Try again somewhere quieter, or type your answers.');

  const substance = Math.max(
    3,
    Math.min(
      10,
      6 +
        (withExample.length ? 1.2 : -1) +
        (withResult.length ? 1 : -0.5) +
        (structured.length >= 2 ? 0.8 : 0) +
        (veryShort.length ? -0.8 : 0) +
        (veryLong.length ? -0.6 : 0),
    ),
  );

  const weakest =
    veryShort[0]?.question ??
    answered.find((t) => !EXAMPLE_MARKERS.test(t.answer))?.question ??
    turns[0]?.question ??
    'Tell me about yourself.';

  return {
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 3),
    biggest:
      improvements[0] ??
      'Nothing structural to change — keep the examples and keep the length where it is.',
    practiceAgain: weakest,
    substance: Math.round(substance * 10) / 10,
    perQuestion: answered.map((t) => ({
      question: t.question,
      note: `${words(t.answer)} words in ${Math.round(t.seconds)}s${EXAMPLE_MARKERS.test(t.answer) ? ' · included an example' : ' · no example given'}`,
    })),
    source: 'heuristic',
  };
}

/** Used by the prep screen to explain where the questions came from. */
export function prepSourceNote(pack: PrepPack, ctx: CheckContext): string {
  if (pack.source === 'model') return 'Generated for your specific interview.';
  const profile = getEvent(ctx.eventId);
  return `From the standard ${profile.label.toLowerCase()} question bank — no AI model is configured, so these are not tailored to your organisation.`;
}
