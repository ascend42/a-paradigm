/**
 * win32SystemRoot (PR #52 review blocker 1): the Windows directory for a win32 child's minimal env. Pure, so it runs on
 * every platform: the env name is matched case-insensitively and the fallback keeps its separator (a 'C:\Windows'
 * JS literal is 'C:Windows').
 */
import { describe, expect, it } from 'vitest';
import { WIN32_SYSTEM_ROOT_FALLBACK, win32SystemRoot } from '../src/platform/win32/system-root.js';

describe('win32SystemRoot', () => {
  it('reads SystemRoot in any case; falls back to C:\\Windows with its separator', () => {
    expect(win32SystemRoot({ SystemRoot: 'D:\\WIN' })).toBe('D:\\WIN');
    expect(win32SystemRoot({ SYSTEMROOT: 'E:\\Win' })).toBe('E:\\Win');
    expect(win32SystemRoot({ systemroot: 'F:\\w' })).toBe('F:\\w');
    expect(win32SystemRoot({})).toBe('C:\\Windows');
    expect(win32SystemRoot({ SystemRoot: '' })).toBe(WIN32_SYSTEM_ROOT_FALLBACK);
    expect(WIN32_SYSTEM_ROOT_FALLBACK).toBe('C:\\Windows');
    expect(WIN32_SYSTEM_ROOT_FALLBACK).not.toBe('C:Windows');
  });

  it('takes only a drive-rooted path (Aegis): relative, drive-relative and UNC values fall back', () => {
    for (const v of ['Windows', 'C:Windows', '\\\\evil\\share', '\\\\?\\C:\\Windows', '\\Windows', 'C:\\'])
      expect(win32SystemRoot({ SystemRoot: v }), v).toBe(WIN32_SYSTEM_ROOT_FALLBACK);
  });

  it('prefers the canonical SystemRoot over another spelling', () => {
    expect(win32SystemRoot({ SYSTEMROOT: 'E:\\Other', SystemRoot: 'D:\\WIN' })).toBe('D:\\WIN');
  });
});
