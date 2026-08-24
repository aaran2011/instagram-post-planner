import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDelivery, analyzeSpeech, EMPTY_PRESENCE } from '../lib/engine/communication';
import { measureImage } from '../lib/vision/image-metrics';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('words per minute is measured, not estimated', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: words(150), seconds: 60 }]);
  assert.equal(speech.wpm, 150);
});

test('too little speech means no pace figure at all', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: 'yes definitely', seconds: 4 }]);
  assert.equal(speech.wpm, null);
});

test('filler words are counted, and the ambiguous ones are still surfaced', () => {
  const speech = analyzeSpeech([
    { question: 'Q', answer: `um so ${words(40)} uh like basically ${words(40)} um`, seconds: 45 },
  ]);
  assert.ok(speech.fillerCount >= 5, `expected fillers, got ${speech.fillerCount}`);
  assert.ok(speech.topFillers.some((f) => f.word === 'um'));
});

test('a fast talker is told to slow down by a specific amount', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: words(220), seconds: 60 }]);
  const delivery = analyzeDelivery(speech, EMPTY_PRESENCE, 'spoken');
  assert.equal(delivery.pace?.verdict, 'fast');
  const advice = delivery.findings.find((f) => f.severity)?.recommendation ?? '';
  assert.match(advice, /slow down/i);
});

test('with no speech recognition, nothing about pace is claimed', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: '', seconds: 30 }]);
  const delivery = analyzeDelivery(speech, EMPTY_PRESENCE, 'unsupported');
  assert.equal(delivery.pace, null);
  assert.ok(delivery.findings.some((f) => /not measured/i.test(f.text)));
  assert.ok(!delivery.findings.some((f) => /words a minute/i.test(f.text)));
});

test('eye contact is never claimed — only head orientation, and it says so', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: words(100), seconds: 50 }]);
  const delivery = analyzeDelivery(speech, { ...EMPTY_PRESENCE, samples: 40, facingRatio: 0.4, inFrameRatio: 1 }, 'spoken');
  assert.ok(delivery.facing);
  assert.match(delivery.facing!.note, /proxy/i);
  assert.ok(!delivery.findings.some((f) => /\beye contact\b/i.test(f.text)));
});

test('nervousness is never asserted as a state of mind', () => {
  const speech = analyzeSpeech([{ question: 'Q', answer: `um ${words(200)} um uh`, seconds: 55 }]);
  const delivery = analyzeDelivery(speech, { ...EMPTY_PRESENCE, samples: 30, facingRatio: 0.3, meanSlouch: 0.8, restlessness: 0.09 }, 'spoken');
  for (const f of delivery.findings) {
    assert.ok(!/\b(nervous|anxious|scared|panicking)\b/i.test(f.text), `"${f.text}" claims an inner state`);
  }
});

/* --------------------------------------------------------------- lighting -- */

function frame(fill: (x: number, y: number) => [number, number, number], width = 40, height = 30) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x / width, y / height);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

test('a bright window behind a dark face reads as backlight', () => {
  const face = { x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.6 };
  const person = { x0: 0.3, y0: 0.1, x1: 0.7, y1: 1 };
  const metrics = measureImage(
    frame((x, y) => (x > 0.3 && x < 0.7 && y > 0.1 ? [50, 45, 42] : [245, 245, 250])),
    face,
    person,
  );
  assert.ok(metrics.faceVsBackground !== null && metrics.faceVsBackground < -0.14, 'backlight must be detectable');
});

test('a warm room reads warm and a blue-lit one reads cool', () => {
  const warm = measureImage(frame(() => [200, 150, 90]));
  const cool = measureImage(frame(() => [110, 140, 200]));
  assert.ok(warm.colorTemp > 0.14);
  assert.ok(cool.colorTemp < -0.1);
});

test('a busy background scores higher on clutter than a blank wall', () => {
  const person = { x0: 0.4, y0: 0.2, x1: 0.6, y1: 1 };
  const blank = measureImage(frame(() => [180, 178, 175]), null, person);
  const busy = measureImage(
    frame((x, y) => ((Math.floor(x * 20) + Math.floor(y * 20)) % 2 ? [30, 30, 30] : [230, 230, 230])),
    null,
    person,
  );
  assert.ok(busy.backgroundBusyness > blank.backgroundBusyness + 0.2);
});

test('typed answers never produce a speaking-pace figure', () => {
  // 200 words "spoken" in 20 seconds is a typing speed, not a delivery.
  const speech = analyzeSpeech([{ question: 'Q', answer: `um like ${words(200)}`, seconds: 20 }]);
  const delivery = analyzeDelivery(speech, EMPTY_PRESENCE, 'typed');
  assert.equal(delivery.pace, null);
  // The disclaimer may mention fillers; what must not appear is a count.
  assert.ok(!delivery.findings.some((f) => /words a minute|\d+ (possible )?filler/i.test(f.text)));
  assert.ok(delivery.findings.some((f) => /typed/i.test(f.text)));
});
