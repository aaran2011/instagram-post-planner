/**
 * Wire validation.
 *
 * Route handlers accept nothing they have not checked: the frame is capped in
 * size, the event id must be one the context engine knows about, and free-text
 * answers are length-limited before they are ever put in a prompt.
 */

import { z } from 'zod';
import { EVENTS } from '../engine/events';

const eventIds = EVENTS.map((e) => e.id) as [string, ...string[]];

export const contextSchema = z.object({
  eventId: z.enum(eventIds),
  customEvent: z.string().max(120).optional(),
  depth: z.enum(['quick', 'deep']),
  answers: z.record(z.string().max(40), z.string().max(200)).default({}),
});

const framingSchema = z.object({
  personDetected: z.boolean(),
  bodyFill: z.number(),
  headVisible: z.boolean(),
  torsoVisible: z.boolean(),
  kneesVisible: z.boolean(),
  feetVisible: z.boolean(),
  eyeLine: z.number(),
  centerX: z.number(),
  cameraPitch: z.number(),
  headYaw: z.number(),
  shoulderTilt: z.number(),
  slouch: z.number(),
  quality: z.number(),
});

const imageSchema = z.object({
  brightness: z.number(),
  faceBrightness: z.number().nullable(),
  faceVsBackground: z.number().nullable(),
  faceSideDelta: z.number().nullable(),
  colorTemp: z.number(),
  clipped: z.number(),
  backgroundBusyness: z.number(),
  contrast: z.number(),
});

/** ~3 MB of base64 is a generous ceiling for a 768px JPEG. */
const MAX_IMAGE_CHARS = 3_000_000;

export const analyzeSchema = z.object({
  ctx: contextSchema,
  metrics: z.object({
    framing: framingSchema.nullable(),
    image: imageSchema.nullable(),
  }),
  coverage: z.enum(['none', 'head', 'upper', 'knees', 'full']),
  /** Omitted when the user declined to send the frame. */
  image: z
    .object({
      data: z.string().max(MAX_IMAGE_CHARS),
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    })
    .nullable()
    .optional(),
});

export const prepareSchema = z.object({ ctx: contextSchema });

export const reviewSchema = z.object({
  ctx: contextSchema,
  turns: z
    .array(
      z.object({
        question: z.string().max(400),
        answer: z.string().max(6000),
        seconds: z.number().min(0).max(1800),
      }),
    )
    .max(8),
});

export type AnalyzeBody = z.infer<typeof analyzeSchema>;
export type PrepareBody = z.infer<typeof prepareSchema>;
export type ReviewBody = z.infer<typeof reviewSchema>;
