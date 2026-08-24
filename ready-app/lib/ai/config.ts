/**
 * AI provider configuration.
 *
 * One switch decides which of two honest modes the app runs in:
 *
 *   configured   — a vision model looks at the frame and the outfit is scored.
 *   demo         — nothing looks at the frame. The outfit is NOT scored, is not
 *                  guessed at, and the UI says so. The on-device measurements
 *                  (camera, light, background, posture) are unaffected: they
 *                  never needed a model in the first place.
 *
 * There is deliberately no third mode where plausible-sounding outfit feedback
 * is generated from nothing.
 */

export const aiConfig = {
  key: process.env.ANTHROPIC_API_KEY?.trim() ?? '',
  model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
  endpoint: 'https://api.anthropic.com/v1/messages',
} as const;

export function aiConfigured(): boolean {
  return aiConfig.key.length > 0;
}
