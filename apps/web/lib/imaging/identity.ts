/**
 * Recognising a scan again, without keeping anything that identifies it.
 *
 * Marks are worth keeping and scans are not. A researcher who spent an hour
 * reading a case should find their marks tomorrow; the scan itself is never
 * persisted, because that is the whole privacy position. So a mark needs
 * something to attach to that survives the scan not being stored.
 *
 * DICOM already has the stable thing: `SeriesInstanceUID` is globally unique
 * and identical every time the same series is opened. It is also a pointer
 * straight back into PACS — not a name, but enough to find one — so writing it
 * into a saved file would put a link to a specific patient's study into
 * whatever gets backed up, synced or shared.
 *
 * **So the UID is hashed with a salt that never leaves this machine, and only
 * the hash is kept.** Reopening the same series here produces the same handle
 * and the marks reattach. The same file opened on another installation produces
 * a different handle, and a marks file that travels carries nothing that can be
 * matched against PACS or against anyone else's records.
 *
 * **The threat this does and does not address.** It stops a *stored or shared*
 * marks file from carrying a pointer to a study. It does not protect against
 * someone with access to this machine, who has the salt sitting beside the
 * marks — and who, in any case, has the scans. Saying which of those it is
 * matters more than the mechanism.
 */

const SALT_KEY = "throughline.imaging.salt";

/** Bytes as lowercase hex. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This installation's salt, made once and kept.
 *
 * Generated from the platform's own randomness rather than from a clock or a
 * counter: a salt anyone can guess is not a salt, and "milliseconds since the
 * epoch" is guessable to within a small range.
 *
 * Returns null where there is nowhere to keep one. That is not an error — a
 * private window has no durable storage, and the honest consequence is that
 * marks do not persist there, which the caller can say plainly instead of
 * silently losing them.
 */
export function installationSalt(storage: Storage | null = safeStorage()):
    string | null {
  if (!storage) return null;
  try {
    const held = storage.getItem(SALT_KEY);
    if (held && held.length >= 32) return held;
    const fresh = hex(crypto.getRandomValues(new Uint8Array(16)));
    storage.setItem(SALT_KEY, fresh);
    return fresh;
  } catch {
    // Storage that exists and throws on write — Safari's private mode does
    // this — is the same situation as no storage at all.
    return null;
  }
}

/** `localStorage`, where there is one that can actually be used. */
export function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined" || localStorage === null) return null;
    // Touched rather than trusted: the accessor exists in contexts where every
    // operation on it throws.
    const probe = "throughline.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The stable thing a series calls itself, if it has one.
 *
 * `SeriesInstanceUID` where present; otherwise the study and series numbers
 * together, which are stable within one study and not beyond it. Returns null
 * rather than inventing something from the pixels: a handle that changed
 * whenever a file was re-exported would silently orphan every mark, which is
 * worse than admitting the scan cannot be recognised.
 */
export function seriesKeyOf(header: Record<string, unknown>): string | null {
  const uid = String(header.SeriesInstanceUID ?? "").trim();
  if (uid) return uid;

  const study = String(header.StudyInstanceUID ?? "").trim();
  const series = String(header.SeriesNumber ?? "").trim();
  if (study && series) return `${study}#${series}`;
  return null;
}

/**
 * An opaque, machine-local handle for a series.
 *
 * SHA-256 over the salt and the key. Asynchronous because the platform's
 * digest is, and that is worth the small awkwardness: rolling a hash by hand
 * to stay synchronous would be choosing a weaker one for the convenience of
 * the calling code.
 */
export async function handleFor(seriesKey: string, salt: string):
    Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${seriesKey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  // Half the digest. Sixteen bytes is far beyond collision range for the few
  // thousand series one installation will ever see, and a shorter handle is
  // easier to read in a stored file somebody is inspecting.
  return hex(new Uint8Array(digest).slice(0, 16));
}

/**
 * The handle for a scan, or null when it cannot be recognised again.
 *
 * Null has three causes and they are worth telling apart at the call site: the
 * file records no stable key, there is nowhere to keep a salt, or the platform
 * has no digest. All three mean the same thing to a researcher — marks made
 * here will not come back — and that is what the interface should say.
 */
export async function scanHandle(
  header: Record<string, unknown>,
  salt: string | null = installationSalt(),
): Promise<string | null> {
  if (!salt) return null;
  const key = seriesKeyOf(header);
  if (!key) return null;
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  return handleFor(key, salt);
}

/**
 * Whether a stored handle could have come from this identifier.
 *
 * For a caller checking that a handle is not itself an identifier — which is
 * the property the whole design rests on, and the kind that is easy to break
 * by later "improving" the handle to include something readable.
 */
export function leaksIdentifier(handle: string,
                                header: Record<string, unknown>): boolean {
  const lower = handle.toLowerCase();
  for (const value of Object.values(header)) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.length >= 4 && lower.includes(text)) return true;
  }
  return false;
}
