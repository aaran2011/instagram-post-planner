import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFraming, measureFraming, type Landmark } from '../lib/vision/framing';

/**
 * Synthetic landmark sets, built to the MediaPipe Pose index layout, so the
 * geometry can be checked without a camera. Coordinates are normalised: y grows
 * downwards, x grows to the right.
 */
function body(overrides: Partial<Record<number, Landmark>> = {}, feet = true): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i: number, x: number, y: number, v = 0.95) => {
    points[i] = { x, y, visibility: v };
  };

  put(0, 0.5, 0.12); // nose
  put(2, 0.47, 0.11); // left eye
  put(5, 0.53, 0.11); // right eye
  put(7, 0.44, 0.11); // left ear
  put(8, 0.56, 0.11); // right ear
  put(11, 0.4, 0.25); // left shoulder
  put(12, 0.6, 0.25); // right shoulder
  put(23, 0.42, 0.5); // left hip
  put(24, 0.58, 0.5); // right hip
  put(25, 0.43, 0.7); // left knee
  put(26, 0.57, 0.7); // right knee
  if (feet) {
    put(27, 0.43, 0.9); // left ankle
    put(28, 0.57, 0.9); // right ankle
    put(31, 0.43, 0.94);
    put(32, 0.57, 0.94);
  }

  for (const [index, landmark] of Object.entries(overrides)) {
    points[Number(index)] = landmark as Landmark;
  }
  return points;
}

test('a full-body frame reports every segment visible', () => {
  const m = measureFraming(body());
  assert.equal(m.personDetected, true);
  assert.equal(m.headVisible, true);
  assert.equal(m.torsoVisible, true);
  assert.equal(m.kneesVisible, true);
  assert.equal(m.feetVisible, true);
  assert.ok(m.bodyFill > 0.7, `expected a tall body fill, got ${m.bodyFill}`);
});

test('feet out of frame are reported as not visible rather than assumed', () => {
  const m = measureFraming(body({}, false));
  assert.equal(m.feetVisible, false);
  assert.equal(m.kneesVisible, true);
  assert.equal(judgeFraming(m, true).coverage, 'knees');
});

test('ears above the eye line read as a camera below eye level', () => {
  // Shooting from below: the ears ride up the frame relative to the eyes.
  const low = measureFraming(body({ 7: { x: 0.44, y: 0.08, visibility: 0.95 }, 8: { x: 0.56, y: 0.08, visibility: 0.95 } }));
  assert.ok(low.cameraPitch > 10, `expected a positive pitch, got ${low.cameraPitch}`);

  const high = measureFraming(body({ 7: { x: 0.44, y: 0.15, visibility: 0.95 }, 8: { x: 0.56, y: 0.15, visibility: 0.95 } }));
  assert.ok(high.cameraPitch < -10, `expected a negative pitch, got ${high.cameraPitch}`);
});

test('a turned head produces a yaw in the direction of the turn', () => {
  const turned = measureFraming(body({ 0: { x: 0.56, y: 0.12, visibility: 0.95 } }));
  assert.ok(Math.abs(turned.headYaw) > 20, `expected a large yaw, got ${turned.headYaw}`);
});

test('judgeFraming gives exactly one instruction, and only when something is wrong', () => {
  const ok = judgeFraming(measureFraming(body()), true);
  assert.equal(ok.ok, true);
  assert.equal(ok.instruction, null);

  const noPerson = judgeFraming(null, true);
  assert.equal(noPerson.ok, false);
  assert.equal(noPerson.instruction, 'Step into the frame');

  // Off to one side: the instruction names the direction to move.
  const shifted = measureFraming(body().map((l) => ({ ...l, x: Math.min(1, l.x + 0.3) })));
  assert.ok(shifted.centerX > 0.72, `expected an off-centre body, got ${shifted.centerX}`);
  assert.equal(judgeFraming(shifted, true).instruction, 'Move slightly left');
});

test('a video call does not demand feet in frame', () => {
  const upperBodyOnly = measureFraming(body({}, false));
  assert.equal(judgeFraming(upperBodyOnly, false).ok, true);
  assert.equal(judgeFraming(upperBodyOnly, true).ok, true); // knees visible: usable, with a note
});
