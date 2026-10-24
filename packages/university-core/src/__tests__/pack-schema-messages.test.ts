/**
 * pack-schema-messages.test.ts — pins the custom Section error messages and
 * strict/passthrough semantics across the zod 3 → 4 migration (zod 4 replaced
 * `errorMap` / `invalid_type_error` with the unified `error` param).
 */

import { describe, it, expect } from 'vitest';
import {
  SectionSchema,
  SectionsArraySchema,
  PackManifestSectionsSchema,
  EntrySectionRefSchema,
  PackSkillRefSchema,
  MAX_SECTIONS_PER_PACK,
} from '../pack-schema.js';

const ok = { id: 'main', name: 'Main', order: 0, style: 'track' };

function firstMessage(schema: { safeParse(v: unknown): any }, value: unknown): string {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return r.error.issues[0].message;
}

describe('pack-schema (zod 4)', () => {
  it('accepts a valid section', () => {
    expect(SectionSchema.parse({ ...ok, default: true })).toEqual({ ...ok, default: true });
  });

  it('keeps the custom style message', () => {
    expect(firstMessage(SectionSchema, { ...ok, style: 'grid' })).toBe(
      'section.style must be one of track|index|chronological|featured',
    );
  });

  it('keeps the custom strict-boolean message for default', () => {
    expect(firstMessage(SectionSchema, { ...ok, default: 'true' })).toBe('section.default must be a boolean');
    expect(firstMessage(SectionSchema, { ...ok, default: 1 })).toBe('section.default must be a boolean');
  });

  it('keeps the id regex and cap messages', () => {
    expect(firstMessage(SectionSchema, { ...ok, id: 'Bad Id' })).toBe('invalid section id');
    const many = Array.from({ length: MAX_SECTIONS_PER_PACK + 1 }, (_, i) => ({ ...ok, id: `s${i}` }));
    expect(firstMessage(SectionsArraySchema, many)).toBe(`sections must contain ≤${MAX_SECTIONS_PER_PACK} entries`);
  });

  it('strict schemas reject unknown keys; passthrough schemas keep them', () => {
    const strict = SectionSchema.safeParse({ ...ok, extra: 1 });
    expect(strict.success).toBe(false);
    expect(strict.error!.issues[0].code).toBe('unrecognized_keys');
    expect(PackSkillRefSchema.safeParse({ path: 'skills/a', extra: 1 }).success).toBe(false);

    expect(PackManifestSectionsSchema.parse({ name: 'pack', sections: [ok] })).toEqual({
      name: 'pack',
      sections: [ok],
    });
    expect(EntrySectionRefSchema.parse({ title: 't', section: 'main' })).toEqual({ title: 't', section: 'main' });
  });
});
