import { CheckFlow } from '@/components/check/flow';
import { EVENTS } from '@/lib/engine/events';
import type { Depth, EventId } from '@/lib/engine/types';

export const metadata = { title: 'Check if you are ready — Ready?' };

const VALID = new Set(EVENTS.map((e) => e.id));

/**
 * Deep links from the home page (`/check?event=wedding&depth=quick`) skip the
 * occasion picker. Anything unrecognised falls through to the picker rather
 * than erroring — a stale bookmark should never be a dead end.
 */
export default async function CheckPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; depth?: string }>;
}) {
  const params = await searchParams;
  const event = params.event && VALID.has(params.event as EventId) ? (params.event as EventId) : null;
  const depth: Depth = params.depth === 'quick' ? 'quick' : 'deep';

  return <CheckFlow initialEvent={event} initialDepth={depth} />;
}
