/**
 * Red-team corpus materializer (test-only).
 *
 * Copies the static fixtures in ./redteam/ into a temp root, then adds the parts
 * that must not live in the repo: token-shaped secrets (assembled at runtime so
 * the repo never contains a scannable key), symlinks to /etc and ../outside,
 * and in-root hard-blocked stores (Maildir, .ssh).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDTEAM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'redteam');
export const HEADING_SENTINEL = 'QUARANTINE-HEADING-SENTINEL';
export const OUTSIDE_SENTINEL = 'OUTSIDE-ROOT-SENTINEL';

const j = (...p: string[]) => p.join('');
const alnum = (n: number, seed = 7) => {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += cs[x % cs.length]; }
  return s;
};

/** Secret-bearing files (root-relative) that MUST end up quarantined. */
export const SECRET_FILES = [
  'secrets/aws.txt',
  'secrets/.env.md',
  'secrets/yaml-block.md',
  'secrets/deploy-key.txt',
  'secrets/openai.md',
  'secrets/slack.txt',
  'secrets/password-note.md',
  'scans/card-and-passport.md',
  'scans/ssn.txt',
];

export const THIRD_PARTY_FILES = [
  'chat-export/dm-alice/messages.json',
  'chat-export/discord.json',
  'chat-export/WhatsApp Chat with Bob.txt',
];

export function materializeRedteam(dest: string): { root: string; outside: string } {
  const root = path.join(dest, 'redteam');
  fs.cpSync(REDTEAM_DIR, root, { recursive: true });
  const w = (rel: string, text: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  w('secrets/aws.txt', `backup creds\n${j('AK', 'IA')}${alnum(16).toUpperCase().replace(/[^A-Z0-9]/g, '7')}\n`);
  w('secrets/.env.md', `# ${HEADING_SENTINEL} env\nANTHROPIC_API_KEY=${j('sk-', 'ant-', 'api03-')}${alnum(40, 3)}\n`);
  w('secrets/yaml-block.md', `---\ntitle: ${HEADING_SENTINEL} title\n---\n# ${HEADING_SENTINEL} heading\n\n\`\`\`yaml\nservice:\n  github_token: ${j('gh', 'p_')}${alnum(36, 5)}\n\`\`\`\n`);
  w('secrets/deploy-key.txt', `${j('-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----')}\nb3BlbnNzaC1rZXktdjEAAAAA\n${j('-----END ', 'OPENSSH ', 'PRIVATE KEY-----')}\n`);
  w('secrets/openai.md', `# ${HEADING_SENTINEL}\nkey ${j('sk-', 'proj-')}${alnum(48, 11)}\n`);
  w('secrets/slack.txt', `bot ${j('xo', 'xb-')}${alnum(12, 13)}-${alnum(24, 17)}\n`);
  w('secrets/password-note.md', `# ${HEADING_SENTINEL} wifi\nPASSWORD=${alnum(14, 19)}\n`);
  // In-root hard-blocked stores
  w('Maildir/cur/1700000000.eml', `From: someone\nSubject: ${HEADING_SENTINEL}\n`);
  w('.ssh/id_rsa', `${j('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----')}\n`);
  w('exports/bitwarden_export_2024.json', '{"items":[]}');
  // Outside-root target + symlinks
  const outside = path.join(dest, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, `${OUTSIDE_SENTINEL}.md`), `# ${OUTSIDE_SENTINEL}\n`);
  fs.symlinkSync('/etc', path.join(root, 'link-etc'));
  fs.symlinkSync('../outside', path.join(root, 'link-outside'));
  fs.symlinkSync(path.join(outside, `${OUTSIDE_SENTINEL}.md`), path.join(root, 'obsidian', 'escape.md'));
  return { root, outside };
}
