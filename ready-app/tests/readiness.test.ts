import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadiness } from '../lib/engine/readiness';
import { scoreAppearance } from '../lib/engine/scoring';
import { deviceFindings } from '../lib/engine/device-findings';
import type { CheckContext, DeviceMetrics, Finding } from '../lib/engine/types';

const ctx: CheckContext = {
  eventId: 'online-interview',
  depth: 'deep',
  answers: { role: 'Marketing Intern', timeLeft: '15' },
};

const goodFraming: DeviceMetrics['framing'] = {
  personDetected: true,
  bodyFill: 0.62,
  headVisible: true,
  torsoVisible: true,
  kneesVisible: false,
  feetVisible: false,
  eyeLine: 0.34,
  centerX: 0.5,
  cameraPitch: 2,
  headYaw: 4,
  shoulderTilt: 2,
  slouch: 0.2,
  quality: 0.9,
};

const goodImage: DeviceMetrics['image'] = {
  brightness: 0.52,
  faceBrightness: 0.56,
  faceVsBackground: 0.06,
  faceSideDelta: 0.04,
  colorTemp: 0.05,
  clipped: 0.01,
  backgroundBusyness: 0.09,
  contrast: 0.18,
};

function reportFor(findings: Finding[] = [], metrics: DeviceMetrics = { framing: goodFraming, image: goodImage }) {
  const device = deviceFindings(ctx, metrics);
  return scoreAppearance({
    ctx,
    findings: [...device.findings, ...findings],
    unavailable: device.unavailable,
    demo: false,
    personDetected: Boolean(metrics.framing?.personDetected),
  });
}

test('a good setup with a good outfit reads as ready', () => {
  const appearance = reportFor([
    {
      id: 'a',
      category: 'outfit',
      kind: 'observed',
      source: 'model',
      text: 'A pressed navy shirt, well fitted through the shoulders.',
      confidence: 'high',
    },
    {
      id: 'b',
      category: 'grooming',
      kind: 'observed',
      source: 'model',
      text: 'Hair is tidy and out of your eyes.',
      confidence: 'high',
    },
  ]);
  const readiness = buildReadiness({ ctx, appearance, prep: { reviewed: true, ready: 4, total: 4 } });
  assert.equal(readiness.state, 'ready');
  assert.ok(readiness.score >= 82, `expected a high score, got ${readiness.score}`);
  assert.ok(readiness.buckets.some((b) => b.id === 'appearance'));
  assert.ok(readiness.buckets.some((b) => b.id === 'setup'));
});

test('one critical problem caps the verdict no matter how high the number is', () => {
  const appearance = reportFor([
    {
      id: 'c',
      category: 'outfit',
      kind: 'inferred',
      source: 'model',
      text: 'A branded hoodie reads far too casual for this interview.',
      confidence: 'high',
      severity: 'critical',
      recommendation: 'Change into a collared shirt',
    },
  ]);
  const readiness = buildReadiness({ ctx, appearance });
  assert.notEqual(readiness.state, 'ready');
  assert.ok(readiness.doNow.length >= 1);
  assert.match(readiness.doNow[0].title, /collared shirt/i);
});

test('a scan that saw nobody cannot produce a "ready" verdict', () => {
  const appearance = reportFor([], { framing: null, image: goodImage });
  const readiness = buildReadiness({ ctx, appearance });
  assert.equal(appearance.inconclusive, 'no-person');
  assert.notEqual(readiness.state, 'ready');
  assert.match(readiness.closing, /could not see enough/i);
});

test('skipping the interview leaves out the communication bucket entirely', () => {
  const withoutInterview = buildReadiness({ ctx, appearance: reportFor() });
  const withInterview = buildReadiness({
    ctx,
    appearance: reportFor(),
    interview: { substance: 8, delivery: 8, findings: [], fixes: [] },
  });
  assert.ok(!withoutInterview.buckets.some((b) => b.id === 'communication'));
  assert.ok(withInterview.buckets.some((b) => b.id === 'communication'));
});

test('a backlit online setup produces a physical instruction, not an adjective', () => {
  const appearance = reportFor([], {
    framing: goodFraming,
    image: { ...goodImage!, faceBrightness: 0.22, faceVsBackground: -0.4, brightness: 0.6 },
  });
  const lighting = appearance.fixes.find((f) => f.category === 'lighting');
  assert.ok(lighting, 'a backlit frame must produce a lighting fix');
  assert.match(lighting!.title, /turn|move|add/i);
});

test('a camera below eye level is answered in centimetres', () => {
  const appearance = reportFor([], {
    framing: { ...goodFraming!, cameraPitch: 25 },
    image: goodImage,
  });
  const camera = appearance.fixes.find((f) => f.category === 'camera');
  assert.ok(camera, 'a low camera must produce a fix');
  assert.match(camera!.title, /\d+\s?cm/);
});

test('preparation is scored as self-reported and labelled that way', () => {
  const readiness = buildReadiness({
    ctx,
    appearance: reportFor(),
    prep: { reviewed: true, ready: 2, total: 4 },
  });
  const prep = readiness.buckets.find((b) => b.id === 'preparation');
  assert.ok(prep);
  assert.match(prep!.detail, /self-reported/i);
});

test('a check with nothing substantive assessed refuses a final number', () => {
  const appearance = reportFor([], { framing: null, image: goodImage });
  const alone = buildReadiness({ ctx, appearance });
  assert.equal(alone.inconclusive, true, 'setup and posture alone are not a readiness verdict');

  // The same inconclusive appearance, but the interview actually happened —
  // now there is real substance to score, so a number is honest again.
  const withInterview = buildReadiness({
    ctx,
    appearance,
    interview: { substance: 8, delivery: 8, findings: [], fixes: [] },
  });
  assert.equal(withInterview.inconclusive, false);
});
