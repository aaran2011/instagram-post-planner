// Timezone-aware scheduling helpers built only on Intl (no external deps).

// Offset (localMillis - utcMillis) for a given instant in an IANA timezone.
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  return asUTC - date.getTime();
}

// Convert a wall-clock local time in `tz` into the correct UTC instant.
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

// Get the local Y/M/D for an instant in a timezone.
export function localParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour === "24" ? "0" : map.hour, 10),
    minute: parseInt(map.minute, 10),
  };
}

export function formatLocal(iso: string, tz: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return { date, time };
}

// Short timezone abbreviation (e.g. IST, PST) for display.
export function tzAbbrev(tz: string, at: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value || tz;
    return name;
  } catch {
    return tz;
  }
}

// Build N future slots given default posting times and a day cadence.
// Slots are always in the future relative to `from`.
export function buildSlots(
  count: number,
  opts: { times: string[]; cadenceDays: number; tz: string; from?: Date },
): Date[] {
  const { times, cadenceDays, tz } = opts;
  const from = opts.from ?? new Date();
  const cleanTimes = (times.length ? times : ["11:00", "19:30"])
    .map((t) => {
      const [h, m] = t.split(":").map((x) => parseInt(x, 10));
      return { h: isNaN(h) ? 11 : h, m: isNaN(m) ? 0 : m };
    })
    .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));

  const slots: Date[] = [];
  const start = localParts(from, tz);
  let dayCursor = new Date(
    zonedTimeToUtc(start.year, start.month, start.day, 0, 0, tz),
  );

  let safety = 0;
  while (slots.length < count && safety < 4000) {
    const lp = localParts(dayCursor, tz);
    for (const t of cleanTimes) {
      const instant = zonedTimeToUtc(lp.year, lp.month, lp.day, t.h, t.m, tz);
      if (instant.getTime() > from.getTime() + 60 * 1000) {
        slots.push(instant);
        if (slots.length >= count) break;
      }
    }
    // Advance by cadence days.
    dayCursor = new Date(
      dayCursor.getTime() + Math.max(1, cadenceDays) * 24 * 60 * 60 * 1000,
    );
    safety++;
  }
  return slots;
}
