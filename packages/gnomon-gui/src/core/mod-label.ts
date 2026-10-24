/**
 * @symbol #gui-offer-slip
 *
 * How the GUI names a mod id `<publisher>.<name>` (S0b §1 Display): glyph + name; the publisher too whenever it is
 * not gnomon. The GUI cannot verify a source, so every third-party publisher counts as unverified here, which also
 * covers a name clash (a first-party name is never a third-party name: the kernel refuses it).
 */
/** The kernel's status.mods.publishers entry for a running mod (Aegis S0b L1). */
export interface PublisherDisplay {
  /** a non-GitHub git host (shown `pub @ host`), else null */
  host: string | null;
  /** verified by its source (gnomon, a github.com owner, a TOFU-bound namespace); a folder/package is not */
  verified: boolean;
}

const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * The label of a mod id. With the kernel's PublisherDisplay: `name (pub @ host)` for a non-GitHub host,
 * `name (pub, unverified)` for a folder/package install, `name (pub)` for a verified github.com owner.
 * Without it (no status yet): `name (pub)` for every non-gnomon id.
 */
export function modLabel(id: string, pd?: PublisherDisplay | null): string {
  const dot = id.indexOf('.');
  if (dot < 0) return id;
  const pub = id.slice(0, dot);
  const name = id.slice(dot + 1);
  if (pub === 'gnomon') return name;
  if (pd && pd.host) return `${name} (${pub} @ ${pd.host})`;
  if (pd && !pd.verified) return `${name} (${pub}, unverified)`;
  return `${name} (${pub})`;
}

/** status.mods.publishers[id], validated (malformed ⇒ null; the label then falls back). */
export function publisherDisplayOf(status: unknown, id: string): PublisherDisplay | null {
  const mods = status && typeof status === 'object' ? (status as { mods?: unknown }).mods : null;
  const map = mods && typeof mods === 'object' ? (mods as { publishers?: unknown }).publishers : null;
  if (!map || typeof map !== 'object' || !Object.hasOwn(map, id)) return null;
  const v = (map as Record<string, unknown>)[id];
  if (!v || typeof v !== 'object') return null;
  const { host, verified } = v as Record<string, unknown>;
  if (typeof verified !== 'boolean' || !(host === null || (typeof host === 'string' && HOST.test(host)))) return null;
  return { host: host as string | null, verified };
}

/** The bare name of a first-party (gnomon.*) mod id, or null. */
export function firstPartyName(id: string): string | null {
  return id.startsWith('gnomon.') ? id.slice(7) : null;
}
