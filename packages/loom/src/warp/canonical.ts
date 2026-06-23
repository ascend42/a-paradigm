/**
 * #canonical-json — strict, deterministic serialization for the essence hash.
 *
 * The byte stream MUST be identical across runs and machines for the same
 * logical value, or the content-address moves for no reason. Rules:
 *   - object keys sorted by codepoint (UTF-16 code unit order via <)
 *   - no insignificant whitespace
 *   - strings NFC-normalized so visually-identical content hashes identically
 *   - undefined/null/NaN/±Infinity are NOT serializable here (callers normalize
 *     them away first); we throw rather than silently diverge
 *   - arrays are serialized positionally — the CALLER is responsible for having
 *     already sorted+deduped every SET before handing it in
 *
 * This is intentionally a tiny dependency-free serializer, not JSON.stringify:
 * JSON.stringify does not sort keys and does not NFC-normalize.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/** Serialize a value to canonical JSON. Throws on non-finite numbers / undefined. */
export function canonicalSerialize(value: CanonicalValue): string {
  return write(value);
}

function write(value: CanonicalValue): string {
  if (value === null || value === undefined) {
    throw new Error('canonicalSerialize: null/undefined is not allowed — normalize to empty first');
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalSerialize: non-finite number ${value}`);
      }
      // Integers and finite doubles serialize identically to JSON here; the
      // essence hash never carries floats, but keep it correct regardless.
      return String(value);
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map(write).join(',')}]`;
      }
      return writeObject(value as { [key: string]: CanonicalValue });
    default:
      throw new Error(`canonicalSerialize: unsupported type ${typeof value}`);
  }
}

function writeObject(obj: { [key: string]: CanonicalValue }): string {
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // absent ≡ omitted (caller already normalized)
    parts.push(`${JSON.stringify(key.normalize('NFC'))}:${write(v)}`);
  }
  return `{${parts.join(',')}}`;
}
