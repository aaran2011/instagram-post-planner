/**
 * Measurements → findings.
 *
 * Everything produced here has `source: 'device'`, meaning a number on the
 * phone decided it, not a language model. These findings are available even
 * with no API key, no network and no permission to send a frame anywhere, which
 * is why camera, lighting, background and posture are never in "demo" mode:
 * they are the same numbers either way.
 *
 * Each rule states a threshold and turns it into one physical instruction.
 * "Raise the phone about 15 cm" is actionable; "improve your camera angle" is
 * not.
 */

import { isOnline } from './events';
import type { CheckContext, Confidence, DeviceMetrics, Finding, Unavailable } from './types';

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

/** Reset between checks so ids stay short and stable-ish in the UI. */
export function resetFindingIds() {
  seq = 0;
}

interface Ctx {
  online: boolean;
  /** Typical arm's-length distance for a phone, used to turn angles into cm. */
  distanceCm: number;
}

function riseCm(pitchDeg: number, distanceCm: number): number {
  const cm = Math.tan((Math.abs(pitchDeg) * Math.PI) / 180) * distanceCm;
  // Round to the nearest 5 cm — the estimate does not deserve more precision.
  return Math.max(5, Math.round(cm / 5) * 5);
}

export function deviceFindings(ctx: CheckContext, metrics: DeviceMetrics): {
  findings: Finding[];
  unavailable: Unavailable[];
} {
  const findings: Finding[] = [];
  const unavailable: Unavailable[] = [];
  const online = isOnline(ctx);
  const cx: Ctx = { online, distanceCm: online ? 55 : 150 };

  const { framing, image } = metrics;

  // A frame this dark makes every visual judgement unreliable, and saying so is
  // more useful than quietly scoring it anyway.
  const murky = !!image && image.brightness < 0.16;
  const dim = (c: Confidence): Confidence => (murky ? 'low' : c);

  if (framing?.personDetected) {
    findings.push(...cameraFindings(framing, cx, dim));
    findings.push(...postureFindings(framing, cx, dim));

    if (!framing.feetVisible && !online) {
      unavailable.push({
        category: 'footwear',
        reason: 'Shoes not visible in the frame — footwear was left out of the score.',
      });
    }
  } else {
    // Either the body model could not run, or it ran and found nobody. Both
    // land in the same place for the user: these were not measured, and we are
    // not going to pretend otherwise.
    const reason =
      'We could not find a body in the frame, so this was not measured. Step fully into view and scan again.';
    unavailable.push({ category: 'posture', reason });
    unavailable.push({ category: 'camera', reason });
  }

  if (online && framing && !framing.feetVisible) {
    // Not a gap: on a call, feet are supposed to be out of frame.
    unavailable.push({
      category: 'footwear',
      reason: 'Not judged — your feet are out of frame on a video call, where they do not matter.',
    });
  }

  if (image) {
    findings.push(...lightingFindings(image, cx, dim));
    if (online) findings.push(...backgroundFindings(image, framing, cx, dim));
  } else {
    unavailable.push({ category: 'lighting', reason: 'The frame could not be measured on this device.' });
  }

  return { findings, unavailable };
}

function cameraFindings(f: NonNullable<DeviceMetrics['framing']>, cx: Ctx, dim: (c: Confidence) => Confidence): Finding[] {
  const out: Finding[] = [];
  const weightHere = cx.online;

  if (f.cameraPitch > 10) {
    const cm = riseCm(f.cameraPitch, cx.distanceCm);
    out.push({
      id: id('cam'),
      category: 'camera',
      kind: 'observed',
      source: 'device',
      text: `The camera is about ${f.cameraPitch}° below your eyes, so it is looking up at you.`,
      confidence: dim(f.cameraPitch > 20 ? 'high' : 'medium'),
      severity: weightHere ? (f.cameraPitch > 20 ? 'critical' : 'improve') : 'polish',
      recommendation: `Raise the camera about ${cm} cm, to eye level`,
      minutes: 1,
    });
  } else if (f.cameraPitch < -12) {
    const cm = riseCm(f.cameraPitch, cx.distanceCm);
    out.push({
      id: id('cam'),
      category: 'camera',
      kind: 'observed',
      source: 'device',
      text: `The camera is roughly ${Math.abs(f.cameraPitch)}° above your eyes, looking down at you.`,
      confidence: dim('medium'),
      severity: weightHere ? 'improve' : 'polish',
      recommendation: `Lower the camera about ${cm} cm, to eye level`,
      minutes: 1,
    });
  }

  if (cx.online) {
    if (f.eyeLine > 0.5) {
      out.push({
        id: id('cam'),
        category: 'camera',
        kind: 'observed',
        source: 'device',
        text: 'Your eyes sit in the lower half of the frame, leaving empty space above your head.',
        confidence: dim('high'),
        severity: 'improve',
        recommendation: 'Raise yourself or tilt the camera so your eyes sit about a third from the top',
        minutes: 1,
      });
    } else if (f.eyeLine < 0.16) {
      out.push({
        id: id('cam'),
        category: 'camera',
        kind: 'observed',
        source: 'device',
        text: 'Your head is very close to the top edge of the frame.',
        confidence: dim('high'),
        severity: 'improve',
        recommendation: 'Tilt the camera up slightly to leave a little headroom',
        minutes: 1,
      });
    }

    if (f.bodyFill > 0.92) {
      out.push({
        id: id('cam'),
        category: 'camera',
        kind: 'observed',
        source: 'device',
        text: 'You fill almost the whole frame, which reads as very close on a call.',
        confidence: dim('medium'),
        severity: 'improve',
        recommendation: 'Move the camera back about an arm’s length',
        minutes: 1,
      });
    }
  }

  if (Math.abs(f.centerX - 0.5) > 0.15) {
    out.push({
      id: id('cam'),
      category: 'camera',
      kind: 'observed',
      source: 'device',
      text: `You are sitting ${Math.round(Math.abs(f.centerX - 0.5) * 100)}% off-centre in the frame.`,
      confidence: dim('high'),
      severity: cx.online ? 'improve' : 'polish',
      recommendation: f.centerX < 0.5 ? 'Shift slightly right to centre yourself' : 'Shift slightly left to centre yourself',
      minutes: 1,
    });
  }

  if (!out.length) {
    out.push({
      id: id('cam'),
      category: 'camera',
      kind: 'observed',
      source: 'device',
      text: 'Camera height and framing are where they should be.',
      confidence: dim('high'),
    });
  }
  return out;
}

function postureFindings(f: NonNullable<DeviceMetrics['framing']>, cx: Ctx, dim: (c: Confidence) => Confidence): Finding[] {
  const out: Finding[] = [];

  if (f.slouch > 0.55) {
    out.push({
      id: id('pos'),
      category: 'posture',
      kind: 'inferred',
      source: 'device',
      text: 'Your head is sitting low and forward relative to your shoulders.',
      confidence: dim(f.slouch > 0.75 ? 'medium' : 'low'),
      severity: f.slouch > 0.75 ? 'improve' : 'polish',
      recommendation: 'Roll your shoulders back and lengthen your neck',
      minutes: 1,
    });
  }

  if (Math.abs(f.shoulderTilt) > 8) {
    out.push({
      id: id('pos'),
      category: 'posture',
      kind: 'observed',
      source: 'device',
      text: `One shoulder is about ${Math.abs(f.shoulderTilt)}° lower than the other.`,
      confidence: dim('medium'),
      severity: Math.abs(f.shoulderTilt) > 14 ? 'improve' : 'polish',
      recommendation: 'Level your shoulders and put your weight evenly on both feet',
      minutes: 1,
    });
  }

  if (Math.abs(f.headYaw) > 22) {
    out.push({
      id: id('pos'),
      category: 'posture',
      kind: 'observed',
      source: 'device',
      text: `Your head is turned roughly ${Math.abs(f.headYaw)}° away from the lens.`,
      confidence: dim('medium'),
      severity: cx.online ? 'improve' : 'polish',
      recommendation: 'Square up so your face is straight on to the camera',
      minutes: 1,
    });
  }

  if (!out.length) {
    out.push({
      id: id('pos'),
      category: 'posture',
      kind: 'observed',
      source: 'device',
      text: 'You are square to the camera and standing evenly.',
      confidence: dim('medium'),
    });
  }
  return out;
}

function lightingFindings(im: NonNullable<DeviceMetrics['image']>, cx: Ctx, dim: (c: Confidence) => Confidence): Finding[] {
  const out: Finding[] = [];
  const critical = cx.online ? 'critical' : 'improve';

  if (im.faceVsBackground !== null && im.faceVsBackground < -0.14) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'The area behind you is much brighter than your face — the light is coming from behind.',
      confidence: 'high',
      severity: critical,
      recommendation: 'Turn around so the window or lamp is in front of you, not behind',
      minutes: 2,
    });
  }

  const faceLevel = im.faceBrightness ?? im.brightness;
  if (faceLevel < 0.28) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: `Your face is reading dark (about ${Math.round(faceLevel * 100)}% brightness).`,
      confidence: 'high',
      severity: faceLevel < 0.18 ? critical : 'improve',
      recommendation: 'Add a light in front of you, or turn towards the window',
      minutes: 2,
    });
  } else if (faceLevel > 0.85 || im.clipped > 0.12) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'Parts of the frame are blown out to pure white, so detail is being lost.',
      confidence: 'medium',
      severity: 'improve',
      recommendation: 'Move away from the direct light or soften it with a curtain',
      minutes: 2,
    });
  }

  if (im.faceSideDelta !== null && im.faceSideDelta > 0.13) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'One side of your face is noticeably brighter than the other.',
      confidence: dim('medium'),
      severity: 'improve',
      recommendation: 'Move the light more in front of you to even out the shadow',
      minutes: 2,
    });
  }

  if (im.colorTemp > 0.14) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'The light has a strong warm/orange cast.',
      confidence: 'medium',
      severity: 'polish',
      recommendation: 'Mix in some daylight or a cooler bulb if you have one nearby',
      minutes: 3,
    });
  } else if (im.colorTemp < -0.1) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'The light is quite cool and blue — often a sign your screen is the main light source.',
      confidence: 'medium',
      severity: 'polish',
      recommendation: 'Add a warmer lamp in front of you so your skin tone reads naturally',
      minutes: 3,
    });
  }

  if (im.contrast < 0.05 && cx.online) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'The whole frame is flat, with very little separation between you and the room.',
      confidence: 'medium',
      severity: 'polish',
      recommendation: 'Put a little more light on your face than on the wall behind you',
      minutes: 3,
    });
  }

  if (!out.length) {
    out.push({
      id: id('lit'),
      category: 'lighting',
      kind: 'observed',
      source: 'device',
      text: 'Your face is evenly lit and clearly visible.',
      confidence: 'high',
    });
  }
  return out;
}

function backgroundFindings(
  im: NonNullable<DeviceMetrics['image']>,
  framing: DeviceMetrics['framing'],
  cx: Ctx,
  dim: (c: Confidence) => Confidence,
): Finding[] {
  const out: Finding[] = [];

  if (im.backgroundBusyness > 0.3) {
    out.push({
      id: id('bg'),
      category: 'background',
      kind: 'inferred',
      source: 'device',
      text: 'There is a lot of visual detail behind you competing for attention.',
      confidence: dim(im.backgroundBusyness > 0.45 ? 'medium' : 'low'),
      severity: im.backgroundBusyness > 0.45 ? 'improve' : 'polish',
      recommendation: 'Move one or two steps so a plainer wall is behind you',
      minutes: 3,
    });
  } else if (im.backgroundBusyness < 0.12) {
    out.push({
      id: id('bg'),
      category: 'background',
      kind: 'observed',
      source: 'device',
      text: 'The background behind you is clean and uncluttered.',
      confidence: dim('medium'),
    });
  }

  if (framing && framing.centerX > 0.72) {
    out.push({
      id: id('bg'),
      category: 'background',
      kind: 'observed',
      source: 'device',
      text: 'You are pressed against the right edge, leaving a large empty area on the left.',
      confidence: dim('medium'),
      severity: 'polish',
      recommendation: 'Centre yourself so the room is balanced around you',
      minutes: 1,
    });
  }

  return out;
}
