/**
 * @symbol #app-bundle
 *
 * #app-bundle (TD-2026-10-21-758 zero-build, T-2026-10-21-029; 8.0 M2) — where a kernel running from a release
 * Gnomon.app finds its siblings. The layout (packages/gnomon-wrapper/src/layout.rs is the wrapper's half; README
 * "Bundle layout"):
 *
 *   <X>.app/Contents/Resources/kernel/{dist,package.json}   this kernel (any file under it identifies the bundle)
 *   <X>.app/Contents/Resources/node/bin/node                 the bundled node (the wrapper spawns the kernel with it,
 *                                                            so process.execPath IS it, and every child inherits it)
 *   <X>.app/Contents/Resources/gnomon-voice/                 the voice client package (+ node_modules/sherpa-onnx-*)
 *   <X>.app/Contents/Helpers/GnomonHelper.app                the signed helper
 *   <X>.app/Contents/Helpers/GnomonVoiceIO.app               the signed voice I/O app
 *
 * Every path is derived from THIS FILE's realpath at run time, never recorded at build or install, so the app runs
 * wherever it is copied (M4 copies it to ~/Applications). Running from a checkout or an npm install is NOT a bundle:
 * the callers fall back to their monorepo / node_modules lookups. Trust is unchanged: the helper and voice-io are
 * still verified by code-signing requirement plus the release sha256 pin (#release-pins) before any use; a path
 * here is only where to look.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_KERNEL_REL = path.join('Contents', 'Resources', 'kernel');
export const BUNDLE_NODE_REL = path.join('Contents', 'Resources', 'node', 'bin', 'node');
export const BUNDLE_VOICE_REL = path.join('Contents', 'Resources', 'gnomon-voice');
export const BUNDLE_HELPERS_REL = path.join('Contents', 'Helpers');
export const HELPER_APP_NAME = 'GnomonHelper.app';
export const HELPER_EXE_IN_APP = path.join('Contents', 'MacOS', 'gnomon-helper');
export const VOICE_IO_APP_NAME = 'GnomonVoiceIO.app';

export interface AppBundle {
  /** the .app directory */
  readonly app: string;
  readonly kernel: string;
  readonly node: string;
  readonly voicePackage: string;
  readonly helperApp: string;
  readonly helperExe: string;
  readonly voiceIoApp: string;
}

function realOr(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The app bundle whose Contents/Resources/kernel contains `from` (a file or directory path, realpath'd), or null when
 * `from` is not inside one. The NEAREST enclosing `<X>.app/Contents/Resources/kernel` wins.
 */
export function appBundleOf(from: string = fileURLToPath(import.meta.url)): AppBundle | null {
  const segs = realOr(from).split(path.sep);
  for (let i = segs.length - 4; i >= 1; i--) {
    if (segs[i]!.endsWith('.app') && segs[i]!.length > 4 && segs[i + 1] === 'Contents' && segs[i + 2] === 'Resources' && segs[i + 3] === 'kernel') {
      const app = segs.slice(0, i + 1).join(path.sep) || path.sep;
      const helpers = path.join(app, BUNDLE_HELPERS_REL);
      return Object.freeze({
        app,
        kernel: path.join(app, BUNDLE_KERNEL_REL),
        node: path.join(app, BUNDLE_NODE_REL),
        voicePackage: path.join(app, BUNDLE_VOICE_REL),
        helperApp: path.join(helpers, HELPER_APP_NAME),
        helperExe: path.join(helpers, HELPER_APP_NAME, HELPER_EXE_IN_APP),
        voiceIoApp: path.join(helpers, VOICE_IO_APP_NAME),
      });
    }
  }
  return null;
}

/**
 * Where M4 installs Gnomon.app (Aegis M2 review high 1): `/Applications` when this user can write it without sudo
 * (an admin user on a stock Mac; App Management protection then guards the installed app), else `~/Applications`
 * (created by the installer). The ONE place that choice is made; M4 calls it.
 */
export function appInstallDir(o: { home?: string; writable?: (dir: string) => boolean } = {}): string {
  const writable =
    o.writable ??
    ((dir: string): boolean => {
      try {
        fs.accessSync(dir, fs.constants.W_OK);
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  return writable('/Applications') ? '/Applications' : path.join(o.home ?? os.homedir(), 'Applications');
}

/** The bundled helper executable when this kernel runs from an app bundle, else null. */
export function bundledHelperPath(from?: string): string | null {
  return appBundleOf(from)?.helperExe ?? null;
}

/**
 * The helper to use for an identity recorded with `recorded`: inside a bundle, ALWAYS the running app's own helper
 * (a recorded path goes stale when the app is moved or replaced; the helper is trusted by signature and release
 * pin, never by path). Outside a bundle, the recorded path, unchanged.
 */
export function helperPathFor(recorded: string, from?: string): string {
  return bundledHelperPath(from) ?? recorded;
}
