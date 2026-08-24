/**
 * Communication Analysis.
 *
 * Split deliberately into what can be counted and what cannot:
 *
 *   counted here   — words per minute, filler frequency, answer length,
 *                    how long you spoke, how often you faced the lens.
 *   judged by AI   — whether the answer was any good (lib/ai/claude.ts).
 *   NOT claimed    — nervousness, confidence as an inner state, and true gaze.
 *
 * The last line is the important one. Head orientation is measurable; where
 * someone's eyes are actually pointing is not, with a body-pose model. So this
 * file reports "facing the camera" and says plainly that it is a proxy, rather
 * than printing an eye-contact score that sounds authoritative and is not.
 */

import type { Finding } from './types';

export interface SpeechTurn {
  question: string;
  answer: string;
  seconds: number;
}

export interface SpeechMetrics {
  totalWords: number;
  totalSeconds: number;
  /** null when nothing was transcribed — never guessed. */
  wpm: number | null;
  fillerCount: number;
  /** Fillers per 100 words. */
  fillerRate: number;
  topFillers: { word: string; count: number }[];
  longestAnswerSeconds: number;
  shortestAnswerWords: number;
  answered: number;
  asked: number;
  /** False when speech recognition never produced text. */
  transcriptAvailable: boolean;
}

/**
 * Counted as fillers. "like", "actually" and "basically" have legitimate uses,
 * so they are reported as *possible* fillers and never as a hard count in the
 * headline number.
 */
const FILLERS: { word: string; pattern: RegExp; certain: boolean }[] = [
  { word: 'um', pattern: /\bum+\b/gi, certain: true },
  { word: 'uh', pattern: /\buh+\b/gi, certain: true },
  { word: 'erm', pattern: /\berm+\b/gi, certain: true },
  { word: 'hmm', pattern: /\bhm+\b/gi, certain: true },
  { word: 'you know', pattern: /\byou know\b/gi, certain: false },
  { word: 'i mean', pattern: /\bi mean\b/gi, certain: false },
  { word: 'like', pattern: /\blike\b/gi, certain: false },
  { word: 'basically', pattern: /\bbasically\b/gi, certain: false },
  { word: 'actually', pattern: /\bactually\b/gi, certain: false },
  { word: 'sort of', pattern: /\bsort of\b/gi, certain: false },
  { word: 'kind of', pattern: /\bkind of\b/gi, certain: false },
];

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function analyzeSpeech(turns: SpeechTurn[]): SpeechMetrics {
  const answered = turns.filter((t) => wordCount(t.answer) > 2);
  const totalWords = answered.reduce((s, t) => s + wordCount(t.answer), 0);
  const totalSeconds = answered.reduce((s, t) => s + t.seconds, 0);

  const counts = new Map<string, number>();
  for (const { word, pattern } of FILLERS) {
    let n = 0;
    for (const t of answered) n += (t.answer.match(pattern) ?? []).length;
    if (n) counts.set(word, n);
  }
  const fillerCount = [...counts.values()].reduce((a, b) => a + b, 0);

  return {
    totalWords,
    totalSeconds: Math.round(totalSeconds),
    // Under fifteen seconds of speech, words-per-minute is arithmetic noise.
    wpm: totalWords > 0 && totalSeconds > 15 ? Math.round((totalWords / totalSeconds) * 60) : null,
    fillerCount,
    fillerRate: totalWords ? Math.round((fillerCount / totalWords) * 1000) / 10 : 0,
    topFillers: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([word, count]) => ({ word, count })),
    longestAnswerSeconds: answered.reduce((m, t) => Math.max(m, Math.round(t.seconds)), 0),
    shortestAnswerWords: answered.length ? Math.min(...answered.map((t) => wordCount(t.answer))) : 0,
    answered: answered.length,
    asked: turns.length,
    transcriptAvailable: totalWords > 0,
  };
}

export interface PresenceMetrics {
  /** How many pose samples were taken during the interview. */
  samples: number;
  /** Share of samples where the head was square to the lens. Proxy, not gaze. */
  facingRatio: number;
  /** Share of samples where the person was in frame at all. */
  inFrameRatio: number;
  meanSlouch: number;
  /** Movement of the body centre between samples — high means restless. */
  restlessness: number;
}

export const EMPTY_PRESENCE: PresenceMetrics = {
  samples: 0,
  facingRatio: 0,
  inFrameRatio: 0,
  meanSlouch: 0,
  restlessness: 0,
};

let seq = 0;
const finding = (f: Omit<Finding, 'id' | 'category' | 'source'>): Finding => ({
  id: `com-${(seq += 1)}`,
  category: 'communication',
  source: 'device',
  ...f,
});

export interface DeliveryReport {
  findings: Finding[];
  /** 0–10 for how it was delivered. Substance is scored separately. */
  delivery: number;
  /** Null when we could not measure it, so the UI can say "not measured". */
  pace: { wpm: number; verdict: 'slow' | 'comfortable' | 'brisk' | 'fast' } | null;
  facing: { percent: number; note: string } | null;
}

/**
 * How the answers were given, which decides what may honestly be measured.
 *
 *   spoken      — audio was transcribed; pace and fillers are real.
 *   typed       — the user chose to type; words-per-minute would be their
 *                 typing speed and "filler words" a writing habit. Neither says
 *                 anything about how they will sound, so neither is reported.
 *   unsupported — the browser has no speech recognition, same silence, but the
 *                 user should be told it was not their choice.
 */
export type AnswerMode = 'spoken' | 'typed' | 'unsupported';

export function analyzeDelivery(speech: SpeechMetrics, presence: PresenceMetrics, mode: AnswerMode): DeliveryReport {
  seq = 0;
  const findings: Finding[] = [];
  const spokenAloud = mode === 'spoken';
  let delivery = 8.5;

  // ---- pace -------------------------------------------------------------
  let pace: DeliveryReport['pace'] = null;
  if (!spokenAloud) {
    findings.push(
      finding({
        kind: 'observed',
        text:
          mode === 'typed'
            ? 'You typed your answers, so speaking pace and filler words were not measured.'
            : 'This browser has no speech recognition, so speaking pace and filler words were not measured.',
        confidence: 'low',
      }),
    );
  } else if (speech.wpm !== null) {
    const wpm = speech.wpm;
    const verdict = wpm > 185 ? 'fast' : wpm > 160 ? 'brisk' : wpm >= 115 ? 'comfortable' : 'slow';
    pace = { wpm, verdict };

    if (verdict === 'fast') {
      delivery -= 1.2;
      findings.push(
        finding({
          kind: 'observed',
          text: `You spoke at about ${wpm} words a minute — quick enough that detail gets lost.`,
          confidence: 'high',
          severity: 'improve',
          recommendation: 'Slow down roughly 15% — pause at the end of each sentence',
          minutes: 1,
        }),
      );
    } else if (verdict === 'brisk') {
      delivery -= 0.4;
      findings.push(
        finding({
          kind: 'observed',
          text: `Your pace was about ${wpm} words a minute — brisk, but still followable.`,
          confidence: 'high',
          severity: 'polish',
          recommendation: 'Take one breath before answering to settle the pace',
          minutes: 1,
        }),
      );
    } else if (verdict === 'slow') {
      delivery -= 0.5;
      findings.push(
        finding({
          kind: 'observed',
          text: `You spoke at about ${wpm} words a minute, which reads as hesitant over a call.`,
          confidence: 'medium',
          severity: 'polish',
          recommendation: 'Push the energy slightly on your first sentence',
          minutes: 1,
        }),
      );
    } else {
      findings.push(
        finding({ kind: 'observed', text: `Your pace was comfortable — about ${wpm} words a minute.`, confidence: 'high' }),
      );
    }
  } else if (speech.asked > 0) {
    findings.push(
      finding({
        kind: 'observed',
        text: 'Too little speech was captured to measure pace reliably.',
        confidence: 'low',
      }),
    );
  }

  // ---- fillers ----------------------------------------------------------
  if (spokenAloud && speech.transcriptAvailable) {
    if (speech.fillerRate > 4) {
      delivery -= 1;
      const top = speech.topFillers.map((f) => `"${f.word}" ×${f.count}`).join(', ');
      findings.push(
        finding({
          kind: 'observed',
          text: `About ${speech.fillerCount} filler words across your answers (${top}).`,
          confidence: 'medium',
          severity: 'improve',
          recommendation: 'Replace the filler with a short silent pause — it reads as considered',
          minutes: 2,
        }),
      );
    } else if (speech.fillerRate > 2) {
      delivery -= 0.3;
      findings.push(
        finding({
          kind: 'observed',
          text: `${speech.fillerCount} possible filler words — not enough to distract, worth noticing.`,
          confidence: 'medium',
          severity: 'polish',
          recommendation: 'Pause instead of bridging with a filler',
          minutes: 2,
        }),
      );
    } else {
      findings.push(
        finding({ kind: 'observed', text: 'Very few filler words — your answers came out clean.', confidence: 'medium' }),
      );
    }

    if (speech.longestAnswerSeconds > 120) {
      delivery -= 0.6;
      findings.push(
        finding({
          kind: 'observed',
          text: `Your longest answer ran ${speech.longestAnswerSeconds} seconds.`,
          confidence: 'high',
          severity: 'improve',
          recommendation: 'Land your answers around 90 seconds, then stop and let them ask',
          minutes: 2,
        }),
      );
    }
  }

  // ---- facing the camera ------------------------------------------------
  let facing: DeliveryReport['facing'] = null;
  if (presence.samples >= 8) {
    const percent = Math.round(presence.facingRatio * 100);
    facing = {
      percent,
      note: 'Measured as head orientation towards the lens. Where your eyes are actually pointing cannot be measured with the on-device body model, so this is a proxy, not a true eye-contact score.',
    };
    if (percent < 55) {
      delivery -= 1;
      findings.push(
        finding({
          kind: 'observed',
          text: `You were square to the camera about ${percent}% of the time — often turned towards the screen instead.`,
          confidence: 'medium',
          severity: 'improve',
          recommendation: 'Drag the video window right under the lens and talk to that',
          minutes: 1,
        }),
      );
    } else if (percent < 75) {
      delivery -= 0.3;
      findings.push(
        finding({
          kind: 'observed',
          text: `You faced the camera about ${percent}% of the time.`,
          confidence: 'medium',
          severity: 'polish',
          recommendation: 'Look at the lens for the first and last line of each answer',
          minutes: 1,
        }),
      );
    } else {
      findings.push(
        finding({ kind: 'observed', text: `You stayed facing the camera ${percent}% of the time.`, confidence: 'medium' }),
      );
    }

    if (presence.meanSlouch > 0.6) {
      delivery -= 0.5;
      findings.push(
        finding({
          kind: 'inferred',
          text: 'Your posture settled lower as the interview went on.',
          confidence: 'low',
          severity: 'polish',
          recommendation: 'Sit forward slightly, weight on your forearms rather than the chair back',
          minutes: 1,
        }),
      );
    }
    if (presence.restlessness > 0.045) {
      findings.push(
        finding({
          kind: 'inferred',
          text: 'There was a fair amount of movement in frame while you answered.',
          confidence: 'low',
          severity: 'polish',
          recommendation: 'Plant both feet and rest your hands — stillness reads as calm on camera',
          minutes: 1,
        }),
      );
    }
  } else {
    findings.push(
      finding({
        kind: 'observed',
        text: 'Camera presence was not measured — the body model was not running during the interview.',
        confidence: 'low',
      }),
    );
  }

  if (speech.asked && speech.answered < speech.asked) {
    const missed = speech.asked - speech.answered;
    findings.push(
      finding({
        kind: 'observed',
        text: `${missed} question${missed > 1 ? 's' : ''} had little or no answer captured.`,
        confidence: 'medium',
      }),
    );
  }

  return {
    findings,
    delivery: Math.round(Math.max(3, Math.min(10, delivery)) * 10) / 10,
    pace,
    facing,
  };
}

/** Plain-language line for the pace chip. */
export function paceLabel(verdict: 'slow' | 'comfortable' | 'brisk' | 'fast'): string {
  return {
    slow: 'A little slow',
    comfortable: 'Comfortable',
    brisk: 'Slightly quick',
    fast: 'Too quick',
  }[verdict];
}
