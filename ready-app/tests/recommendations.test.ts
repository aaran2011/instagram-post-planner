import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doNowList, pathToPerfect, planForTime, prioritise } from '../lib/engine/recommendations';
import type { AppearanceReport, Fix } from '../lib/engine/types';

const fix = (over: Partial<Fix> = {}): Fix => ({
  id: over.id ?? 'x',
  category: 'outfit',
  title: 'Tuck in your shirt',
  severity: 'improve',
  minutes: 2,
  impact: 0.4,
  ...over,
});

const report = (fixes: Fix[], overall = 7.5): AppearanceReport => ({
  categories: [],
  unavailable: [],
  overall,
  fixes,
  strengths: [],
  demo: false,
  checklist: [],
  appearanceScored: true,
  inconclusive: false,
});

test('critical problems lead the list regardless of how cheap the others are', () => {
  const ordered = prioritise([
    fix({ id: 'cheap', severity: 'polish', minutes: 1, impact: 0.3 }),
    fix({ id: 'big', severity: 'critical', minutes: 10, impact: 1.2 }),
  ]);
  assert.equal(ordered[0].id, 'big');
});

test('a two-minute plan only contains what fits in two minutes', () => {
  const plan = planForTime(
    report([
      fix({ id: 'quick', minutes: 1, impact: 0.3 }),
      fix({ id: 'slow', minutes: 20, impact: 0.9 }),
    ]),
    2,
  );
  assert.deepEqual(plan.fixes.map((f) => f.id), ['quick']);
  assert.deepEqual(plan.deferred.map((f) => f.id), ['slow']);
  assert.match(plan.note, /left out/);
});

test('a critical fix is never silently dropped for being slow', () => {
  const plan = planForTime(report([fix({ id: 'urgent', severity: 'critical', minutes: 30, impact: 1.5 })]), 5);
  assert.deepEqual(plan.fixes.map((f) => f.id), ['urgent']);
  assert.equal(plan.deferred.length, 0);
});

test('"plenty of time" includes everything', () => {
  const plan = planForTime(report([fix({ id: 'a', minutes: 30 }), fix({ id: 'b', minutes: 45 })]), 999);
  assert.equal(plan.fixes.length, 2);
  assert.equal(plan.deferred.length, 0);
});

test('make me a 10/10 invents nothing when you are already there', () => {
  const plan = pathToPerfect(report([fix()], 9.6));
  assert.equal(plan.alreadyThere, true);
  assert.equal(plan.steps.length, 0);
  assert.match(plan.message, /already/i);
});

test('make me a 10/10 finds the smallest set of changes, not all of them', () => {
  const plan = pathToPerfect(
    report(
      [
        fix({ id: 'big', impact: 1.5 }),
        fix({ id: 'medium', impact: 0.8 }),
        fix({ id: 'tiny1', impact: 0.05 }),
        fix({ id: 'tiny2', impact: 0.04 }),
        fix({ id: 'tiny3', impact: 0.03 }),
      ],
      7.5,
    ),
  );
  assert.ok(plan.steps.length <= 3, `expected a short list, got ${plan.steps.length}`);
  assert.ok(plan.projected > 9, `expected the projection to reach the top, got ${plan.projected}`);
  assert.ok(!plan.steps.some((s) => s.id === 'tiny3'), 'noise-level changes are not recommendations');
});

test('the do-now list is short and never repeats itself', () => {
  const list = doNowList([
    fix({ id: 'a', title: 'Fix your collar' }),
    fix({ id: 'b', title: 'Fix your collar' }),
    fix({ id: 'c', title: 'Raise the camera', category: 'camera' }),
    fix({ id: 'd', title: 'Move the lamp', category: 'lighting' }),
    fix({ id: 'e', title: 'Level your shoulders', category: 'posture' }),
    fix({ id: 'f', title: 'Change your shoes', category: 'footwear' }),
  ]);
  assert.ok(list.length <= 4);
  assert.equal(new Set(list.map((f) => f.title)).size, list.length);
});

test('a short list spans the problem instead of repeating one category', () => {
  const list = doNowList([
    fix({ id: 'cam1', category: 'camera', title: 'Raise the camera 20 cm', impact: 0.5 }),
    fix({ id: 'cam2', category: 'camera', title: 'Tilt the camera up slightly', impact: 0.45 }),
    fix({ id: 'cam3', category: 'camera', title: 'Centre yourself', impact: 0.4 }),
    fix({ id: 'light', category: 'lighting', title: 'Turn towards the window', impact: 0.3 }),
    fix({ id: 'outfit', category: 'outfit', title: 'Fix your collar', impact: 0.2 }),
  ]);
  const categories = list.map((f) => f.category);
  assert.ok(categories.includes('lighting'), 'the light problem must survive three camera problems');
  assert.ok(categories.includes('outfit'));
  assert.ok(categories.filter((c) => c === 'camera').length <= 2);
});
