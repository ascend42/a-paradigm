import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock @a-company/premise-core before importing the module under test
vi.mock('@a-company/premise-core', () => ({
  searchSymbols: vi.fn(),
  checkAspectAnchors: vi.fn(),
}));

import { checkSpecCompliance, checkCodeQuality, type ComplianceContext } from './compliance-checker.js';
import { searchSymbols, checkAspectAnchors } from '@a-company/premise-core';

const mockSearchSymbols = vi.mocked(searchSymbols);
const mockCheckAspectAnchors = vi.mocked(checkAspectAnchors);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-check-'));
  vi.clearAllMocks();
  // Default: checkAspectAnchors returns empty (no aspect-anchor issues)
  mockCheckAspectAnchors.mockReturnValue([]);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────
// checkSpecCompliance
// ────────────────────────────────────────────────────────

describe('checkSpecCompliance', () => {
  function makeCtx(overrides?: Partial<ComplianceContext>): ComplianceContext {
    return {
      rootDir: tmpDir,
      index: {},
      gateConfig: null,
      purposeFiles: [],
      ...overrides,
    };
  }

  it('unregistered symbol produces blocking finding with purpose-coverage category', () => {
    mockSearchSymbols.mockReturnValue([]);

    const findings = checkSpecCompliance([], ['#unregistered'], makeCtx());

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const purposeFinding = findings.find(f => f.category === 'purpose-coverage');
    expect(purposeFinding).toBeDefined();
    expect(purposeFinding!.type).toBe('blocking');
    expect(purposeFinding!.message).toContain('#unregistered');
  });

  it('gate symbol not in portal produces blocking finding with portal-compliance category', () => {
    // searchSymbols returns empty for the gate (not registered in purpose)
    // but the portal-compliance check is independent of that
    mockSearchSymbols.mockReturnValue([]);

    const ctx = makeCtx({
      gateConfig: {
        gates: {},
        routes: {},
      },
    });

    const findings = checkSpecCompliance([], ['^my-gate'], ctx);

    const portalFinding = findings.find(f => f.category === 'portal-compliance');
    expect(portalFinding).toBeDefined();
    expect(portalFinding!.type).toBe('blocking');
    expect(portalFinding!.message).toContain('^my-gate');
  });

  it('gate declared in portal does not produce portal-compliance finding', () => {
    mockSearchSymbols.mockReturnValue([
      { id: '1', symbol: '^auth', type: 'gate', source: 'portal', filePath: 'portal.yaml', data: {}, references: [], referencedBy: [] },
    ]);

    const ctx = makeCtx({
      gateConfig: {
        gates: { '^auth': { description: 'Auth gate' } },
        routes: {},
      },
    });

    const findings = checkSpecCompliance([], ['^auth'], ctx);
    const portalFinding = findings.find(f => f.category === 'portal-compliance');

    expect(portalFinding).toBeUndefined();
  });

  it('empty inputs produce no findings', () => {
    const findings = checkSpecCompliance([], [], makeCtx());

    expect(findings).toEqual([]);
  });

  it('registered symbol does not produce purpose-coverage finding', () => {
    mockSearchSymbols.mockReturnValue([
      { id: '1', symbol: '#known', type: 'component', source: 'purpose', filePath: '.purpose', data: {}, references: [], referencedBy: [] },
    ]);

    const findings = checkSpecCompliance([], ['#known'], makeCtx());
    const purposeFinding = findings.find(f => f.category === 'purpose-coverage');

    expect(purposeFinding).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// checkCodeQuality
// ────────────────────────────────────────────────────────

describe('checkCodeQuality', () => {
  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('detects eval() as blocking security finding', () => {
    writeFile('danger.ts', 'const result = eval(userInput);\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'danger.ts')], tmpDir);

    const evalFinding = findings.find(f => f.category === 'security' && f.message.includes('eval'));
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.type).toBe('blocking');
    expect(evalFinding!.line).toBe(1);
  });

  it('detects hardcoded password as blocking security finding', () => {
    writeFile('secrets.ts', 'const password = "secret12345678";\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'secrets.ts')], tmpDir);

    const secretFinding = findings.find(f => f.category === 'security' && f.message.includes('secret'));
    expect(secretFinding).toBeDefined();
    expect(secretFinding!.type).toBe('blocking');
  });

  it('detects console.log as note convention finding', () => {
    writeFile('app.ts', 'console.log("debug message");\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'app.ts')], tmpDir);

    const consoleFinding = findings.find(f => f.category === 'convention');
    expect(consoleFinding).toBeDefined();
    expect(consoleFinding!.type).toBe('note');
    expect(consoleFinding!.message).toContain('console.log');
  });

  it('clean file produces no findings', () => {
    writeFile('clean.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'clean.ts')], tmpDir);

    expect(findings).toEqual([]);
  });

  it('non-source file (.md) is skipped and produces no findings', () => {
    writeFile('readme.md', 'Use eval(x) here and password = "supersecret123"\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'readme.md')], tmpDir);

    expect(findings).toEqual([]);
  });

  it('commented-out eval is not flagged', () => {
    writeFile('safe.ts', '// eval(something) is dangerous\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'safe.ts')], tmpDir);
    const evalFinding = findings.find(f => f.message.includes('eval'));

    expect(evalFinding).toBeUndefined();
  });

  it('commented-out secret is not flagged', () => {
    writeFile('safe.ts', '// password = "mysupersecretpassword"\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'safe.ts')], tmpDir);
    const secretFinding = findings.find(f => f.category === 'security');

    expect(secretFinding).toBeUndefined();
  });

  it('reports correct line numbers', () => {
    writeFile('multi.ts', 'const x = 1;\nconst y = 2;\nconst z = eval(x);\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'multi.ts')], tmpDir);
    const evalFinding = findings.find(f => f.message.includes('eval'));

    expect(evalFinding).toBeDefined();
    expect(evalFinding!.line).toBe(3);
  });

  it('reports relative file paths', () => {
    writeFile('src/deep/file.ts', 'eval(x);\n');

    const findings = checkCodeQuality([path.join(tmpDir, 'src/deep/file.ts')], tmpDir);

    expect(findings[0].file).toBe(path.join('src', 'deep', 'file.ts'));
  });

  it('handles non-existent files gracefully', () => {
    const findings = checkCodeQuality([path.join(tmpDir, 'missing.ts')], tmpDir);

    expect(findings).toEqual([]);
  });

  it('checks multiple file types (.js, .jsx, .tsx, .py, .rs)', () => {
    const extensions = ['.js', '.jsx', '.tsx', '.py', '.rs'];
    for (const ext of extensions) {
      writeFile(`file${ext}`, 'eval(x);\n');
    }

    const allFiles = extensions.map(ext => path.join(tmpDir, `file${ext}`));
    const findings = checkCodeQuality(allFiles, tmpDir);
    const evalFindings = findings.filter(f => f.message.includes('eval'));

    expect(evalFindings).toHaveLength(extensions.length);
  });
});
