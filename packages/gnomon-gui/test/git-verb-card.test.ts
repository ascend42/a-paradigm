/**
 * #git-verbs on the card (T-2026-10-23-002): a push card shows the kernel-resolved host and repo on its k-line and folds
 * ONE Always choice, "push to <host>/<owner>/<repo>", under "Always ▾" — only from the contentHash-verified git-verb
 * node. A lookalike host card (claim-mismatch, no always) keeps its whole body with Deny focused; a force push offers
 * no Always.
 */
import { describe, expect, it } from 'vitest';
import { ALWAYS_REMOTE_NOTE, cardContentHash, gitVerbLine, gitVerbOf, gitVerbWarning, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

const detail = { verb: 'git.push', tool: 'gnomon_git_push', host: 'github.com', owner: 'ascend42', repo: 'a-platform-fighter', slug: 'github.com/ascend42/a-platform-fighter', url: 'https://github.com/ascend42/a-platform-fighter.git', remote: 'origin', branch: 'main', force: false, root: '/r', inputHash: 'sha256:' + 'a'.repeat(64) };
const base = { kind: 'permission', requestedBy: 'p:x/s-1', hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0' };
// Mika: the title names host/owner/repo (the host stays in the title: the spoofing defence); the full URL is the body's next line
const title = 'Push main to github.com/ascend42/a-platform-fighter';
const blockOf = (d: Record<string, unknown>, first = title) => ({ schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: first }, { type: 'Text', text: 'host: github.com' }, { type: 'git-verb', detail: d }] });
const cardOf = (d: Record<string, unknown>, extra: Record<string, unknown> = {}, first = title) => ({ ...base, ...extra, block: blockOf(d, first), contentHash: cardContentHash({ ...base, ...extra }, d) });
const view = (card: Record<string, unknown>, decisions: string[], flags: string[] = [], alwaysOpen = false) => ({ cardId: 'card:01J', kind: 'permission', requestedBy: base.requestedBy, hsid: null, repo: null, state: 'pending', contentHash: String(card.contentHash), flags, decisions, decidable: true, gitVerb: gitVerbOf(card), alwaysOpen });

describe('G-GIT-05 git verb cards', () => {
  it('reads only a verified node', () => {
    const card = cardOf(detail);
    expect(gitVerbOf(card)).toMatchObject({ verb: 'git.push', host: 'github.com', slug: 'github.com/ascend42/a-platform-fighter', branch: 'main', force: false });
    expect(gitVerbOf({ ...card, contentHash: 'sha256:' + '0'.repeat(64) })).toBeNull();
    expect(gitVerbOf({ ...card, block: blockOf({ ...detail, verb: 'rm -rf' }) })).toBeNull();
    expect(gitVerbLine(gitVerbOf(card)!)).toBe('github.com · ascend42/a-platform-fighter · branch main');
    expect(gitVerbLine({ verb: 'repo.create', host: 'github.com', slug: 'github.com/a/b', branch: 'main', visibility: 'private', force: false })).toBe('github.com · a/b · private · branch main');
  });
  it('a push card: the title, the host line, Allow · Deny · Always ▾ folding one "push to <repo>" choice with its note', () => {
    const card = cardOf(detail);
    const el = renderCard({ doc: fdoc }, view(card, ['allow', 'deny', 'always'], [], true), card.block) as unknown as FEl;
    expect(el.all().find((e) => e.className.startsWith('card-title'))!.text).toBe(title);
    expect(el.all().find((e) => e.className.startsWith('k-line'))!.text).toBe('github.com · ascend42/a-platform-fighter · branch main');
    const row = el.all().find((e) => e.className === 'card-keys')!;
    expect(row.all().filter((e) => e.tag === 'button').map((e) => e.text)).toEqual(['allow', 'deny', 'Always ▴']);
    const keys = el.all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(keys.map((e) => [e.attrs.get('aria-label'), e.text, e.attrs.get('data-scope')])).toEqual([['Always: push to github.com/ascend42/a-platform-fighter', 'push to github.com/ascend42/a-platform-fighter', 'exact']]);
    expect(el.all().filter((e) => e.className === 'always-note').map((e) => e.text)).toEqual([ALWAYS_REMOTE_NOTE]);
  });
  it('a force push or a lookalike host offers no Always; the lookalike keeps its warning first with Deny focused', () => {
    const f = cardOf({ ...detail, force: true }, { flags: ['irreversible'] });
    const fe = renderCard({ doc: fdoc }, view(f, ['allow', 'deny'], ['irreversible']), f.block) as unknown as FEl;
    expect(fe.all().some((e) => e.attrs.get('data-decision') === 'always')).toBe(false);
    // Mika (Delta 8): what can't be taken back is on the face (not under details), once, beside the irreversible chip
    expect(fe.all().find((e) => e.className.startsWith('k-line'))!.text).toBe('github.com · ascend42/a-platform-fighter · branch main');
    expect(fe.all().filter((e) => e.className.startsWith('card-warn')).map((e) => e.text)).toEqual(['Force push: it can overwrite commits on the remote that your branch does not have.']);
    expect(fe.all().find((e) => e.className === 'card-details')!.all().some((e) => e.className.startsWith('card-warn'))).toBe(false);
    const warn = 'Warning: the host githuh.com looks like github.com but is a different host. Deny unless you meant this host.';
    const l = cardOf({ ...detail, host: 'githuh.com', slug: 'githuh.com/ascend42/a-platform-fighter', hostWarning: 'x' }, { flags: ['claim-mismatch'] }, warn);
    const le = renderCard({ doc: fdoc }, view(l, ['allow', 'deny'], ['claim-mismatch']), l.block) as unknown as FEl;
    expect(le.all().some((e) => e.attrs.get('data-decision') === 'always')).toBe(false);
    expect(le.all().find((e) => e.attrs.get('data-decision') === 'deny')!.attrs.get('data-default')).toBe('true');
    expect(le.text).toContain(warn);
    // the lookalike's warning is the first thing under the title: no k-line, no face warning before it
    expect(le.all().some((e) => e.className.startsWith('k-line') || e.className.startsWith('card-warn'))).toBe(false);
  });
  it('a public repo and a force remove say so on the face; a plain push, a private create, init and add do not', () => {
    const g = (o: Record<string, unknown>) => ({ verb: 'git.push', host: 'github.com', slug: 'github.com/a/b', branch: 'main', visibility: null, force: false, ...o }) as Parameters<typeof gitVerbWarning>[0];
    expect(gitVerbWarning(g({ verb: 'repo.create', visibility: 'public' }))).toBe('Public: anyone can see this repo and its whole history.');
    expect(gitVerbWarning(g({ verb: 'git.worktree.remove', force: true }))).toBe('Force remove: uncommitted changes in this worktree are lost.');
    for (const o of [{}, { verb: 'repo.create', visibility: 'private' }, { verb: 'git.init' }, { verb: 'git.worktree.add' }, { verb: 'git.worktree.remove' }]) expect(gitVerbWarning(g(o))).toBeNull();
    const pub = cardOf({ ...detail, verb: 'repo.create', tool: 'gnomon_repo_create', visibility: 'public' }, { flags: ['irreversible'] }, 'Create github.com/ascend42/a-platform-fighter (public), then push main to it');
    const pe = renderCard({ doc: fdoc }, view(pub, ['allow', 'deny'], ['irreversible']), pub.block) as unknown as FEl;
    expect(pe.all().find((e) => e.className.startsWith('card-warn'))!.text).toMatch(/^Public: /);
    expect(pe.all().some((e) => e.attrs.get('data-decision') === 'always')).toBe(false);
  });
});
