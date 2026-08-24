import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseVision } from '../lib/ai/claude';

/**
 * These tests treat the model as hostile. The system prompt asks it not to
 * comment on people's bodies and not to describe what it cannot see; this pass
 * is what makes those requests guarantees, so it is tested with exactly the
 * output the prompt forbids.
 */

test('commentary on appearance is dropped, not shown', () => {
  const result = normaliseVision(
    {
      findings: [
        { category: 'outfit', text: 'The shirt is creased across the back.', severity: 'improve', recommendation: 'Press the shirt', confidence: 'high' },
        { category: 'grooming', text: 'A very attractive, slim person.', severity: 'none', confidence: 'high' },
        { category: 'outfit', text: 'The cut flatters a slim body shape.', severity: 'polish', recommendation: 'Keep it', confidence: 'medium' },
        { category: 'grooming', text: 'Fix the acne before the call.', severity: 'critical', recommendation: 'Cover the blemish', confidence: 'high' },
      ],
    },
    'full',
    false,
  );

  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].text, /creased/);
});

test('shoes are never discussed when they are out of frame', () => {
  const cropped = normaliseVision(
    { findings: [{ category: 'footwear', text: 'The trainers look scuffed.', severity: 'improve', recommendation: 'Wipe them down', confidence: 'low' }] },
    'knees',
    false,
  );
  assert.equal(cropped.findings.length, 0);

  const online = normaliseVision(
    { findings: [{ category: 'footwear', text: 'Formal shoes, well polished.', severity: 'none', confidence: 'high' }] },
    'full',
    true,
  );
  assert.equal(online.findings.length, 0);
});

test('a category the model invented is ignored', () => {
  const result = normaliseVision(
    {
      findings: [
        { category: 'lighting', text: 'The room is dim.', severity: 'critical', recommendation: 'Add a lamp', confidence: 'high' },
        { category: 'vibes', text: 'Great energy.', severity: 'none', confidence: 'high' },
        { category: 'outfit', text: 'Collar sits flat.', severity: 'none', confidence: 'high' },
      ],
    },
    'full',
    false,
  );
  assert.deepEqual(result.findings.map((f) => f.category), ['outfit']);
});

test('a criticism with no action becomes an observation instead of a penalty', () => {
  const result = normaliseVision(
    { findings: [{ category: 'outfit', text: 'The jacket is loud.', severity: 'critical', confidence: 'high' }] },
    'full',
    false,
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, undefined);
});

test('unknown confidence and severity values fall back to safe defaults', () => {
  const result = normaliseVision(
    { findings: [{ category: 'outfit', text: 'Shirt untucked.', severity: 'catastrophic', confidence: 'certain', recommendation: 'Tuck it in' }] },
    'full',
    false,
  );
  assert.equal(result.findings[0].confidence, 'medium');
  assert.equal(result.findings[0].severity, undefined, 'an unrecognised severity must not be treated as a penalty');
});

test('silence about accessories is reported as not judged, never as "none"', () => {
  const result = normaliseVision(
    { findings: [{ category: 'outfit', text: 'Navy suit, well fitted.', severity: 'none', confidence: 'high' }] },
    'full',
    false,
  );
  assert.ok(result.unavailable.some((u) => u.category === 'accessories'));
});

test('a face the model could not see means grooming is not judged', () => {
  const result = normaliseVision(
    { visible: { face: false }, findings: [{ category: 'outfit', text: 'Dark jacket.', severity: 'none', confidence: 'low' }] },
    'full',
    false,
  );
  assert.ok(result.unavailable.some((u) => u.category === 'grooming'));
});
