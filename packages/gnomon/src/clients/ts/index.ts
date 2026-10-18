/**
 * @symbol #gnomon-ts-client
 *
 * #gnomon-ts-client public entry (spec §12.8): the client, plus the published
 * display rules re-exported from @a-company/gnomon-contracts so a UI built on
 * this client draws cards with the one §4.5 sanitizer.
 */
export * from './client.js';
export { sanitizeDisplayText, eventRow, renderDenominator, type SanitizedText, type EventRow } from '@a-company/gnomon-contracts';
