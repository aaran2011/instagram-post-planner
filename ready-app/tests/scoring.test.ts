import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAppearance, costOf, verdictFor } from '../lib/engine/scoring';
import { weightsFor, questionsFor } from '../lib/engine/events';
import type { CheckContext, Finding } from '../lib/engine/types';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  eventId: 'job-interview',
  depth: 'deep',
  answers: { modality: 'in-person' },
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: over.id ?? 'f1',
  category: 'outfit',
  kind: 'observed',
  source: 'model',
  text: 'Shirt is untucked at the back.',
  confidence: 'high',
  severity: 'improve',
  recommendation: 'Tuck the shirt in evenly',
  ...over,
});

test('nothing found means a high score, not a middling one', () => {
  const report = scoreAppearance({
    ctx: ctx(),
    findings: [finding({ severity: undefined, recommendation: undefined, text: 'Colours coordinate well.' })],
    unavailable: [],
    demo: false,
    personDetected: true,
  });
  assert.ok(report.overall >= 9, `an unflagged outfit should score 9+, got ${report.overall}`);
});

test('confidence scales what a finding costs', () => {
  const high = costOf(finding({ confidence: 'high' }));
  const low = costOf(finding({ confidence: 'low' }));
  assert.ok(low < high, 'a low-confidence finding must cost less');
  assert.equal(Math.round(low * 100) / 100, Math.round(high * 0.5 * 100) / 100);
});

test('the model never sets a number: identical severities cost identically', () => {
  const a = costOf(finding({ category: 'grooming', text: 'Hair is unbrushed.' }));
  const b = costOf(finding({ category: 'outfit', text: 'Collar is folded under.' }));
  assert.equal(a, b);
});

test('a criticism with no action attached does not cost points', () => {
  const report = scoreAppearance({
    ctx: ctx(),
    findings: [finding({ recommendation: undefined })],
    unavailable: [],
    demo: false,
    personDetected: true,
  });
  assert.equal(report.fixes.length, 0);
});

test('checklist items are shown but never scored', () => {
  const report = scoreAppearance({
    ctx: ctx(),
    findings: [finding({ source: 'checklist', severity: 'critical', text: 'Check your collar' })],
    unavailable: [],
    demo: true,
    personDetected: true,
  });
  assert.equal(report.checklist.length, 1);
  assert.equal(report.fixes.length, 0);
  const outfit = report.categories.find((c) => c.id === 'outfit');
  assert.ok(!outfit || outfit.score >= 9, 'a checklist item must not move the score');
});

/** One observation per scoreable category, so nothing is dropped for lack of evidence. */
const everyCategory = (['outfit', 'grooming', 'accessories', 'footwear', 'posture', 'camera', 'lighting'] as const).map(
  (category, i) =>
    finding({ id: `s${i}`, category, severity: undefined, recommendation: undefined, text: `${category} looks fine.` }),
);

test('a category nobody looked at is not scored as if it were fine', () => {
  const report = scoreAppearance({
    ctx: ctx(),
    findings: [finding({ category: 'outfit', severity: undefined, recommendation: undefined, text: 'Well coordinated.' })],
    unavailable: [],
    demo: false,
    personDetected: true,
  });
  assert.deepEqual(report.categories.map((c) => c.id), ['outfit']);
  assert.ok(report.unavailable.some((u) => u.category === 'grooming'));
  assert.match(report.unavailable.find((u) => u.category === 'grooming')!.reason, /left out rather than assumed/i);
});

test('an unavailable category is dropped from the score, not zeroed', () => {
  const withShoes = scoreAppearance({ ctx: ctx(), findings: everyCategory, unavailable: [], demo: false, personDetected: true });
  const withoutShoes = scoreAppearance({
    ctx: ctx(),
    findings: everyCategory,
    unavailable: [{ category: 'footwear', reason: 'Shoes not visible' }],
    demo: false,
    personDetected: true,
  });
  assert.ok(withShoes.categories.some((c) => c.id === 'footwear'));
  assert.ok(!withoutShoes.categories.some((c) => c.id === 'footwear'));
  assert.equal(withoutShoes.overall, withShoes.overall, 'excluding a category must not drag the average down');
  assert.equal(withoutShoes.unavailable.length, 1);
});

test('an online interview does not judge footwear at all', () => {
  const online = ctx({ eventId: 'online-interview', answers: {} });
  const weights = weightsFor(online);
  assert.equal(weights.footwear, 0);
  assert.ok((weights.camera ?? 0) >= 5);
  assert.ok((weights.lighting ?? 0) >= 5);

  const report = scoreAppearance({
    ctx: online,
    findings: [finding({ category: 'footwear', text: 'Trainers are scuffed.' })],
    unavailable: [],
    demo: false,
    personDetected: true,
  });
  assert.ok(!report.categories.some((c) => c.id === 'footwear'));
  assert.equal(report.fixes.length, 0, 'a shoe fix must never be offered for a video call');
});

test('an in-person interview weights shoes and barely weights the background', () => {
  const weights = weightsFor(ctx());
  assert.ok((weights.footwear ?? 0) >= 3);
  assert.equal(weights.background ?? 0, 0);
});

test('a frame with nobody in it is inconclusive, and says so', () => {
  // Only an incidental lighting reading came back, and the body model found
  // nobody. A number here would be a number about a room, not a person.
  const report = scoreAppearance({
    ctx: ctx({ eventId: 'online-interview', answers: {} }),
    findings: [finding({ category: 'lighting', severity: undefined, recommendation: undefined, source: 'device', text: 'Light is even.' })],
    unavailable: [],
    demo: true,
    personDetected: false,
  });
  assert.equal(report.inconclusive, 'no-person');
});

test('the verdict wording never insults anyone', () => {
  for (const score of [1, 4, 6, 8, 10]) {
    const { headline } = verdictFor(score);
    assert.ok(!/bad|terrible|awful|ugly|poor/i.test(headline), `"${headline}" is not coaching`);
  }
});

test('progressive disclosure removes questions the answers made irrelevant', () => {
  const inPerson = questionsFor(ctx());
  assert.ok(inPerson.some((q) => q.id === 'setting'), 'in person, indoors/outdoors matters');

  const online = questionsFor(ctx({ eventId: 'online-interview', answers: {} }));
  assert.ok(!online.some((q) => q.id === 'setting'), 'an online interview is never outdoors-relevant');
  assert.ok(!online.some((q) => q.id === 'modality'), 'the format is already known');
});

test('a quick check asks only the essentials', () => {
  const quick = questionsFor(ctx({ depth: 'quick' }));
  const deep = questionsFor(ctx());
  assert.ok(quick.length < deep.length);
  assert.ok(quick.every((q) => q.essential));
});

test('a demo-mode wedding says the outfit was never looked at, not that we could not see you', () => {
  // A wedding is judged almost entirely on the outfit. With no vision model,
  // posture alone is left — a number there would be meaningless, and the reason
  // must not blame the user's framing.
  const report = scoreAppearance({
    ctx: ctx({ eventId: 'wedding', answers: { role: 'guest' } }),
    findings: [finding({ category: 'posture', source: 'device', severity: undefined, recommendation: undefined, text: 'Shoulders are level.' })],
    unavailable: [
      { category: 'outfit', reason: 'No vision model is connected.' },
      { category: 'grooming', reason: 'No vision model is connected.' },
      { category: 'accessories', reason: 'No vision model is connected.' },
      { category: 'footwear', reason: 'No vision model is connected.' },
    ],
    demo: true,
    personDetected: true,
  });
  assert.equal(report.inconclusive, 'nothing-scored');
});
