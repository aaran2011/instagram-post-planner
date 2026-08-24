# Integration seams

Three features are designed for but deliberately not built: a digital wardrobe,
weather-aware advice, and synced history. Each has a typed seam here so it can
be added without reshaping the app.

The rule they all follow: **an unconfigured integration is invisible.** No
greyed-out buttons, no "coming soon" cards, no permission prompt for a feature
that does not exist yet. `wardrobe.ts` returns an empty wardrobe and the outfit
screens simply never mention one; `weather.ts` reports `unavailable` and nothing
asks for location.

## Wardrobe (`wardrobe.ts`)

Photograph garments, get combinations back for a given occasion. The seam is
`WardrobeProvider`, and the recommendation engine already accepts an optional
list of owned items — when one is supplied, fixes can say "swap to the brown
shoes you own" instead of "wear darker shoes".

## Weather (`weather.ts`)

Adds outdoor-comfort findings for events flagged as outdoors. The provider
takes coordinates and returns a small normalised forecast. Location is only ever
requested from a user gesture, and only when a key is configured.

## History (`../store/history.ts`)

Local today. The stored shape is already the shape a server would return, so a
sync layer means swapping the read/write pair for fetches.
