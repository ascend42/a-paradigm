/**
 * @symbol #gnomon-trace
 *
 * Where a traced session's raw capture lives (minimal mirror on the
 * gnomon/trace-cli branch of the capture builder's src/kernel/trace/capture.ts;
 * reconciled at merge, identical behaviour): `<projectReal>/.gnomon/trace/`
 * and the hsid with every ':' replaced by '-' (':' is not a legal Windows
 * filename character), plus `.jsonl`.
 */
import * as path from 'node:path';

export function traceFileName(hsid: string): string {
  return `${hsid.replaceAll(':', '-')}.jsonl`;
}

export function traceDirOf(projectReal: string): string {
  return path.join(projectReal, '.gnomon', 'trace');
}
