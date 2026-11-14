// ─── Notification pop-ups ───
// A Notification that arrives while the bell's popover is closed pops up
// beside the bell. Pure and browser-safe, so the stacking rule can be tested
// without React or Knock.

/** How many pop-ups stack beside the bell at once. */
export const MAX_POP_UPS = 3;

/** About how long a pop-up stays before it goes on its own. */
export const POP_UP_LIFETIME_MS = 6000;

/** The fields of a Knock feed item that stacking needs. */
type PopUpItem = { id: string; inserted_at: string };

/**
 * The pop-ups to show after `arrived` reach the feed: newest first, each
 * Notification once, and at most three, so the oldest drop off.
 */
export function stackPopUps<T extends PopUpItem>(
  showing: T[],
  arrived: T[]
): T[] {
  const showingIds = new Set(showing.map((item) => item.id));
  const newcomers = arrived.filter((item) => !showingIds.has(item.id));
  return [...newcomers, ...showing]
    .sort((a, b) => Date.parse(b.inserted_at) - Date.parse(a.inserted_at))
    .slice(0, MAX_POP_UPS);
}
