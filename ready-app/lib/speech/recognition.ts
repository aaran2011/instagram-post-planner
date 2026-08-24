'use client';

/**
 * Speech capture for the mock interview.
 *
 * Uses the browser's own speech recognition. On Chrome that means audio is
 * processed by Google's service, which is a real privacy fact and is stated
 * on screen before the interview starts — not buried here.
 *
 * When the API is missing (Firefox, some Android browsers) nothing is faked:
 * the interview switches to typed answers and every downstream number that
 * needed audio — pace, filler count — is reported as "not measured" rather
 * than estimated.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function constructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return constructor() !== null;
}

export interface Listener {
  start: () => void;
  stop: () => void;
  /** Everything heard since `reset()`, final segments only. */
  transcript: () => string;
  /** The words currently being formed, for the live caption. */
  interim: () => string;
  reset: () => void;
  destroy: () => void;
}

export function createListener(options: {
  lang?: string;
  onUpdate?: (final: string, interim: string) => void;
  onError?: (kind: 'denied' | 'no-speech' | 'network' | 'other') => void;
}): Listener | null {
  const Ctor = constructor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = options.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US') ?? 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = '';
  let interimText = '';
  let wantRunning = false;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (result.isFinal) finalText += `${text.trim()} `;
      else interim += text;
    }
    interimText = interim;
    options.onUpdate?.(finalText.trim(), interim.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      wantRunning = false;
      options.onError?.('denied');
    } else if (event.error === 'no-speech') {
      options.onError?.('no-speech');
    } else if (event.error === 'network') {
      options.onError?.('network');
    } else if (event.error !== 'aborted') {
      options.onError?.('other');
    }
  };

  // Chrome ends the session after a pause even in continuous mode, which would
  // silently truncate a thoughtful answer. Restart while the answer is open.
  recognition.onend = () => {
    if (!wantRunning) return;
    try {
      recognition.start();
    } catch {
      /* already starting */
    }
  };

  return {
    start() {
      wantRunning = true;
      try {
        recognition.start();
      } catch {
        /* start() throws if already running */
      }
    },
    stop() {
      wantRunning = false;
      try {
        recognition.stop();
      } catch {
        /* not running */
      }
    },
    transcript: () => finalText.trim(),
    interim: () => interimText.trim(),
    reset() {
      finalText = '';
      interimText = '';
    },
    destroy() {
      wantRunning = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* nothing running */
      }
    },
  };
}
