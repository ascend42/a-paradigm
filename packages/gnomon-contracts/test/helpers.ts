/**
 * Test helpers: a minimal JSON Schema (2020-12 subset) evaluator — enough for
 * the keywords our generated schemas use — so G-CON-01 checks the JSON Schemas
 * themselves without adding a dependency. `tolerant` applies the §4.9
 * compatible-additive rule: `enum` on x-gnomon-additive nodes and
 * `additionalProperties:false` are not enforced.
 */
type S = Record<string, any>;

export function jsonSchemaErrors(schema: S, value: unknown, tolerant = false, root: S = schema, path = '$'): string[] {
  // boolean schemas (2020-12): false rejects everything, true accepts everything — in every mode.
  if ((schema as unknown) === false) return [`${path}: false schema`];
  if ((schema as unknown) === true) return [];
  const errs: string[] = [];
  if (schema.$ref) {
    const target = (schema.$ref as string).replace(/^#\//, '').split('/').reduce((o: S, k: string) => o[k], root);
    return jsonSchemaErrors(target, value, tolerant, root, path);
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errs.push(`${path}: const`);
  if (schema.type) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual =
      value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return [`${path}: type ${actual} not in ${types.join('|')}`];
  }
  if (schema.enum && !(tolerant && schema['x-gnomon-additive']) && !schema.enum.includes(value)) errs.push(`${path}: enum`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: pattern`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: minLength`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: maxItems`);
    if (schema.items) value.forEach((v, i) => errs.push(...jsonSchemaErrors(schema.items, v, tolerant, root, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as S;
    for (const r of schema.required ?? []) if (!(r in obj)) errs.push(`${path}: required ${r}`);
    for (const [k, v] of Object.entries(obj)) {
      if (schema.properties && k in schema.properties) errs.push(...jsonSchemaErrors(schema.properties[k], v, tolerant, root, `${path}.${k}`));
      else if (schema.additionalProperties === false && !tolerant) errs.push(`${path}: additional ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        errs.push(...jsonSchemaErrors(schema.additionalProperties, v, tolerant, root, `${path}.${k}`));
    }
  }
  return errs;
}

/** Extract the string-literal members of `export type <name> = 'a' | 'b' ...;` from TS source. */
export function unionLiterals(source: string, name: string): string[] {
  const m = new RegExp(`export type ${name}\\s*=([^;]+);`).exec(source);
  if (!m) throw new Error(`type ${name} not found`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
