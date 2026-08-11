// A compact, practical timezone list for the picker. The app works with any
// valid IANA zone; these are just convenient defaults.
export const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "UTC",
];

export function tzListWith(current: string) {
  return TIMEZONES.includes(current) ? TIMEZONES : [current, ...TIMEZONES];
}
