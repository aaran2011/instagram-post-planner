import { NextResponse } from 'next/server';
import { aiConfigured } from '@/lib/ai/config';
import { weatherConfigured } from '@/lib/integrations/weather';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What this deployment can actually do.
 *
 * The client asks once on load so that every screen can tell the truth about
 * its own limits before the user has spent time on a check — rather than
 * discovering at the results screen that the outfit was never looked at.
 */
export async function GET() {
  return NextResponse.json(
    {
      vision: aiConfigured(),
      weather: weatherConfigured(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
