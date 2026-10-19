/**
 * @symbol #gui-setup
 *
 * #gui-setup digest copy (spec §11.1, §2.4 rule 9). The digest ALWAYS comes
 * from the kernel's setup.presence event (the #provisioner composed the row);
 * the page never computes or accepts one from anywhere else. The helper's
 * own line (the LAST line of the Touch ID dialog) is
 * `Gnomon Helper: root key signs 1: <d12>; row <schema> <kind>`, so the copy
 * says the line must BEGIN with the expected prefix (Aegis MEDIUM-3).
 */

/** `3f2a91c07be4` → `3f2a 91c0 7be4` (the CLI's groupDigest). */
export function groupDigest(d: string): string {
  return (d.match(/.{1,4}/g) ?? []).join(' ');
}

export const DIGEST12 = /^[0-9a-f]{12}$/;

/** The prefix the helper line must begin with (exact helper wording from the provisioner, I1). */
export function expectedHelperLine(d12: string): string {
  return `Gnomon Helper: root key signs 1: ${d12}`;
}

export function digestInstruction(d12: string): string {
  return `The LAST line of the Touch ID dialog must begin with "${expectedHelperLine(d12)}". If it doesn't, press Cancel. Cancelling is always safe: nothing half-done is kept.`;
}

/** The two identity cards, each explained (presence purposes from the #provisioner). */
export const IDENTITY_CARDS: Readonly<Record<'approvals-binding' | 'device-row', { title: string; body: string }>> = Object.freeze({
  'approvals-binding': {
    title: 'Touch ID 1 of 2: your root key vouches for your approvals key',
    body: 'Your root key lives in the Secure Enclave and is used almost never. This signature says your everyday approvals key speaks for you.',
  },
  'device-row': {
    title: "Touch ID 2 of 2: the root registers this Mac's device key",
    body: 'This signature registers this Mac, so the kernel knows the approvals it sees come from your own machine.',
  },
});

export const TWO_PROMPTS_NOTICE =
  'Next come EXACTLY 2 Touch ID prompts. Before each one this page shows a code; the dialog must show the same code. A third prompt during setup is an attack: press Cancel. (If the helper crashes, cleaning up may ask for one more prompt per key it made; cancelling that is safe too.)';

export function purgeCopy(gen: string): string {
  return `The Secure Enclave holds Gnomon keys of generation ${gen} that ~/.gnomon does not use. Another Gnomon home on this Mac may still use them. Setup never adopts them; to continue, delete them (one Touch ID per key).`;
}
