/**
 * @symbol #gui-offer-slip
 *
 * How the GUI names a mod id `<publisher>.<name>` (S0b §1 Display): glyph + name; the publisher too whenever it is
 * not gnomon. The GUI cannot verify a source, so every third-party publisher counts as unverified here, which also
 * covers a name clash (a first-party name is never a third-party name: the kernel refuses it).
 */
export function modLabel(id: string): string {
  const dot = id.indexOf('.');
  if (dot < 0) return id;
  const pub = id.slice(0, dot);
  const name = id.slice(dot + 1);
  return pub === 'gnomon' ? name : `${name} (${pub})`;
}

/** The bare name of a first-party (gnomon.*) mod id, or null. */
export function firstPartyName(id: string): string | null {
  return id.startsWith('gnomon.') ? id.slice(7) : null;
}
