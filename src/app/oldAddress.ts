// The app was renamed from Flickwise to Heartbeat and moved to a new address. The old address keeps serving
// the same build and shows a notice, because saved plays live in the browser and are tied to the address.

/** The address the app used before the rename. */
export const OLD_HOSTNAME = 'flickwise.ajshaham.workers.dev';
/** The address the app lives at now. */
export const NEW_HOSTNAME = 'heartbeat.ajshaham.workers.dev';
export const NEW_URL = `https://${NEW_HOSTNAME}`;

/** True when the page is served from the old address. `hostname` is `location.hostname`. */
export function isOldAddress(hostname: string): boolean {
  return hostname.toLowerCase() === OLD_HOSTNAME;
}

export const MOVED_SHORT = 'Flickwise is now Heartbeat.';
export const MOVED_MESSAGE = `Flickwise is now Heartbeat, at ${NEW_HOSTNAME}. Your plays are saved in this browser under this old address, so export them here and import them there.`;
export const MOVED_EXPORTED = (plays: number): string =>
  `Exported ${plays} ${plays === 1 ? 'play' : 'plays'}. Open Heartbeat and import the file in Settings, under Data.`;
