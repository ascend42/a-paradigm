/**
 * @symbol #gui-setup
 *
 * #gui-setup copy (spec §11.1, §2.4 rule 9). The digest ALWAYS comes from the
 * kernel's setup.presence event (the #provisioner composed the row); the page
 * never computes or accepts one from anywhere else. The helper's own line
 * (the LAST line of the dialog) is
 * `Gnomon Helper: root key signs 1: <d12>; row <schema> <kind>`, so the copy
 * says the line must BEGIN with the expected prefix (Aegis MEDIUM-3). A Mac
 * without Touch ID asks for the login password instead, so the copy says
 * "Touch ID (or your password)".
 */

/** `3f2a91c07be4` → `3f2a 91c0 7be4` (the CLI's groupDigest). */
export function groupDigest(d: string): string {
  return (d.match(/.{1,4}/g) ?? []).join(' ');
}

export const DIGEST12 = /^[0-9a-f]{12}$/;
export const PRESENCE = 'Touch ID (or your password)';

/** The prefix the helper line must begin with (exact helper wording from the provisioner, I1). */
export function expectedHelperLine(d12: string): string {
  return `Gnomon Helper: root key signs 1: ${d12}`;
}

export function digestInstruction(d12: string): string {
  return `The LAST line of the dialog must begin with "${expectedHelperLine(d12)}". If it doesn't, press Cancel. Cancelling is always safe.`;
}

/** The words the cards use, each in one plain line. */
export const GLOSSARY = Object.freeze({
  root: 'Root key: the master key of your Gnomon identity. It lives in this Mac\'s Secure Enclave, never leaves it, and is used only for setup steps like these.',
  device: 'Device key: a key stored on this Mac that proves a connection to Gnomon comes from this Mac.',
  kernel: 'Kernel: the Gnomon program running on this Mac that watches your Claude Code sessions and asks you before risky steps.',
});

/** The two identity cards, each explained (presence purposes from the #provisioner). */
export const IDENTITY_CARDS: Readonly<Record<'approvals-binding' | 'device-row', { title: string; body: string }>> = Object.freeze({
  'approvals-binding': {
    title: `${PRESENCE} 1 of 2: your root key vouches for your approvals key`,
    body: 'Your approvals key signs each "yes" you give Gnomon. This signature says it speaks for you.',
  },
  'device-row': {
    title: `${PRESENCE} 2 of 2: the root registers this Mac's device key`,
    body: 'This signature registers this Mac, so the kernel knows the approvals it sees come from your own machine.',
  },
});

export const TWO_PROMPTS_NOTICE = `Next come EXACTLY 2 ${PRESENCE} prompts. Before each one this page shows a code; the dialog must show the same code. A third prompt to SIGN during setup is an attack: press Cancel. If something fails (for example the helper crashes), cleanup may ask extra prompts to DELETE the keys this run created; cancelling those is safe.`;

export const NAME_NOTE = 'This name appears on every approval you sign and in the kernel log, as p:<namespace>/<name>. Lowercase letters, digits, ".", "_" or "-".';

export function purgeCopy(gen: string): string {
  return `The Secure Enclave holds Gnomon keys of generation ${gen} that ~/.gnomon does not use. Another Gnomon home on this Mac may still use them. Setup never adopts them; to continue, delete them (one ${PRESENCE} per key).`;
}
