/**
 * T-2026-10-26-003 (the local lane after the 2026-10-26 qwen3.5 run): read_file is paged and capped at the
 * session's share of the working budget; at the step limit the run asks ONCE, tools disabled, for an answer.
 * Against the FAKE in-process OpenAI-compatible server; never a real model. Paths are built with path.join
 * (Windows CI).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, COMPAT_ALLOWLIST, MAX_READ, runTool, STEP_LIMIT_PROMPT, TOOLS, type ChatMessage } from '../src/index.js';
import { fakeOpenAI, type FakeServer } from './fake-openai.js';

let srv: FakeServer | null = null;
let tmp: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lane-'))));

describe('read_file is paged in bytes and capped at the session share', () => {
  it('pages through a file with offset; each partial page names the total, the bytes returned and the next offset', async () => {
    const cwd = scratch();
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i).padStart(4, '0')}\n`).join('');
    fs.writeFileSync(path.join(cwd, 'f.txt'), text);
    const ctx = { cwd, roots: [cwd], readCap: 1024 };
    const pages: string[] = [];
    let offset = 0;
    for (let n = 0; n < 10; n++) {
      const r = await runTool('read_file', { path: 'f.txt', offset }, ctx);
      expect(r.isError).toBe(false);
      const m = /\n\[read_file: f\.txt is (\d+) bytes; returned bytes (\d+)-(\d+) \((\d+) bytes\)\.( Call read_file with path="f\.txt" offset=(\d+) for more\.| This is the end of the file\.)\]$/.exec(r.content);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(Buffer.byteLength(text));
      expect(Number(m![2])).toBe(offset);
      expect(Number(m![4])).toBeLessThanOrEqual(1024);
      pages.push(r.content.slice(0, m!.index));
      if (!m![6]) break;
      offset = Number(m![6]);
    }
    expect(pages.join('')).toBe(text);
    expect(pages.length).toBe(Math.ceil(Buffer.byteLength(text) / 1024));
  });

  it('a whole small file comes back bare (no note); limit narrows a page, never widens it past the cap', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'small.txt'), 'fine');
    expect(await runTool('read_file', { path: 'small.txt' }, { cwd, roots: [cwd], readCap: 1024 })).toEqual({ content: 'fine', isError: false });
    fs.writeFileSync(path.join(cwd, 'big.txt'), 'b'.repeat(5000));
    const narrow = await runTool('read_file', { path: 'big.txt', limit: 600 }, { cwd, roots: [cwd], readCap: 1024 });
    expect(narrow.content).toMatch(/returned bytes 0-600 \(600 bytes\)\. Call read_file with path="big\.txt" offset=600 for more/);
    const wide = await runTool('read_file', { path: 'big.txt', limit: 4000 }, { cwd, roots: [cwd], readCap: 1024 });
    expect(wide.content).toMatch(/returned bytes 0-1024 \(1024 bytes\)/);
    const tail = await runTool('read_file', { path: 'big.txt', offset: 4500 }, { cwd, roots: [cwd], readCap: 1024 });
    expect(tail.content).toMatch(/returned bytes 4500-5000 \(500 bytes\)\. This is the end of the file\.\]$/);
    expect((await runTool('read_file', { path: 'big.txt', offset: 9999 }, { cwd, roots: [cwd] })).content).toMatch(/past the end/);
  });

  it('bad offset/limit is a tool error, not a crash', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'abc');
    for (const args of [{ offset: -1 }, { offset: 1.5 }, { limit: 'lots' }]) {
      const r = await runTool('read_file', { path: 'a.txt', ...args }, { cwd, roots: [cwd] });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/non-negative integer \(bytes\)/);
    }
    // a numeric string (a model's habit) is read as the number
    expect((await runTool('read_file', { path: 'a.txt', offset: '1' }, { cwd, roots: [cwd] })).content).toMatch(/^bc\n\[read_file/);
  });

  it('a page never splits a UTF-8 character', async () => {
    const cwd = scratch();
    const text = 'é'.repeat(1000); // 2 bytes each
    fs.writeFileSync(path.join(cwd, 'u.txt'), text);
    const first = await runTool('read_file', { path: 'u.txt' }, { cwd, roots: [cwd], readCap: 1025 });
    const m = /returned bytes 0-(\d+) /.exec(first.content)!;
    expect(Number(m[1])).toBe(1024);
    expect(first.content).not.toContain('�');
    const second = await runTool('read_file', { path: 'u.txt', offset: 1024, limit: 2000 }, { cwd, roots: [cwd], readCap: 2000 });
    expect(first.content.split('\n[read_file')[0]! + second.content.split('\n[read_file')[0]!).toBe(text);
  });

  it('MAX_READ stays the absolute ceiling whatever the session share', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'huge.txt'), 'h'.repeat(MAX_READ + 5000));
    const r = await runTool('read_file', { path: 'huge.txt' }, { cwd, roots: [cwd], readCap: 10 * MAX_READ });
    expect(r.content).toContain(`returned bytes 0-${MAX_READ} (${MAX_READ} bytes)`);
  });

  it('a nested path built with path.join reads (Windows separators included)', async () => {
    const cwd = scratch();
    fs.mkdirSync(path.join(cwd, 'sub', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'sub', 'deeper', 'n.txt'), 'n'.repeat(3000));
    const r = await runTool('read_file', { path: path.join('sub', 'deeper', 'n.txt') }, { cwd, roots: [cwd], readCap: 1000 });
    expect(r.isError).toBe(false);
    expect(r.content).toContain(`[read_file: ${path.join('sub', 'deeper', 'n.txt')} is 3000 bytes; returned bytes 0-1000`);
  });

  it('the tool description and schema tell the model about offset and limit (bytes)', () => {
    const t = TOOLS.find((x) => x.name === 'read_file')!;
    expect(Object.keys(t.parameters.properties as object)).toEqual(['path', 'offset', 'limit']);
    expect(t.description.split('\n')[0]).toMatch(/offset\/limit in BYTES/);
  });

  it('the agent caps a turn\'s reads at a quarter of its budget, split across that turn\'s read_file calls', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'a'.repeat(50_000));
    fs.writeFileSync(path.join(cwd, 'b.txt'), 'b'.repeat(50_000));
    srv = await fakeOpenAI({ script: [{ toolCalls: [{ name: 'read_file', arguments: '{"path":"a.txt"}' }] }, { toolCalls: [{ name: 'read_file', arguments: '{"path":"a.txt"}' }, { name: 'read_file', arguments: '{"path":"b.txt"}' }] }, { content: 'ok' }] });
    const evs: Array<Record<string, unknown>> = [];
    await new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, roots: [cwd], maxSteps: 6, maxTokens: 256, contextTarget: 8192, emit: (e) => evs.push(e) }).prompt('read');
    const tool = (srv.requests[1]!.messages as ChatMessage[]).find((m) => m.role === 'tool')!;
    const one = Number(/returned bytes 0-(\d+)/.exec(tool.content)![1]);
    expect(one).toBeGreaterThan(4000);
    expect(one).toBeLessThan(8192); // a quarter of a ~6.7k-token budget, as bytes
    const two = (srv.requests[2]!.messages as ChatMessage[]).filter((m) => m.role === 'tool').slice(-2);
    for (const m of two) expect(Number(/returned bytes 0-(\d+)/.exec(m.content)![1])).toBe(Math.floor(one / 2));
  });
});

describe('the step limit ends with an answer', () => {
  const LIST = { toolCalls: [{ name: 'list_dir', arguments: '{}' }] };

  it('one final request with tools disabled; its text is the reply; stopReason stays max_steps; agent_end fires once', async () => {
    const cwd = scratch();
    srv = await fakeOpenAI({ script: [LIST, LIST, { content: 'Found X; Y is unresolved.' }] });
    const evs: Array<Record<string, unknown>> = [];
    await new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, roots: [cwd], maxSteps: 2, maxTokens: 64, emit: (e) => evs.push(e) }).prompt('look');
    expect(srv.requests).toHaveLength(3);
    const final = srv.requests[2]!;
    expect(final.tools).toBeUndefined();
    expect((final.messages as ChatMessage[]).at(-1)).toEqual({ role: 'user', content: STEP_LIMIT_PROMPT });
    const ends = evs.filter((e) => e.type === 'message_end');
    expect(ends.at(-1)).toMatchObject({ message: { role: 'assistant', content: 'Found X; Y is unresolved.', toolCalls: [] } });
    expect(evs.filter((e) => e.type === 'tool_execution_start')).toHaveLength(2);
    expect(evs.filter((e) => e.type === 'agent_end')).toHaveLength(1);
    expect(evs.at(-1)).toEqual({ type: 'agent_end', stopReason: 'max_steps', usage: { input: 300, output: 60 } });
  });

  it('text-tool mode: the prompt joins the trailing <tool_result> message (roles alternate); a tool block in the answer is stripped, never run', async () => {
    const cwd = scratch();
    srv = await fakeOpenAI({ script: [{ content: '<tool_call>{"name":"list_dir","arguments":{}}</tool_call>' }, { content: 'Partial answer.\n<tool_call>{"name":"list_dir","arguments":{}}</tool_call>' }] });
    const evs: Array<Record<string, unknown>> = [];
    await new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST.ollama!, nativeTools: false, surface: 'compact', cwd, roots: [cwd], maxSteps: 1, maxTokens: 64, emit: (e) => evs.push(e) }).prompt('look');
    const msgs = srv.requests[1]!.messages as ChatMessage[];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs.at(-1)!.content.startsWith('<tool_result name="list_dir">')).toBe(true);
    expect(msgs.at(-1)!.content.endsWith(`\n\n${STEP_LIMIT_PROMPT}`)).toBe(true);
    expect(evs.filter((e) => e.type === 'tool_execution_start')).toHaveLength(1);
    expect(evs.filter((e) => e.type === 'message_end').at(-1)).toMatchObject({ message: { content: 'Partial answer.' } });
    expect(evs.at(-1)).toMatchObject({ type: 'agent_end', stopReason: 'max_steps' });
  });

  it('a failing final request ends max_steps with its error', async () => {
    const cwd = scratch();
    srv = await fakeOpenAI({ script: [LIST, { httpStatus: 500, httpError: 'slot crashed' }] });
    const evs: Array<Record<string, unknown>> = [];
    await new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, roots: [cwd], maxSteps: 1, maxTokens: 64, emit: (e) => evs.push(e) }).prompt('look');
    expect(evs.filter((e) => e.type === 'agent_end')).toHaveLength(1);
    expect(evs.at(-1)).toMatchObject({ type: 'agent_end', stopReason: 'max_steps', error: expect.stringMatching(/HTTP 500/) });
  });

  it('over the budget at the limit: compact first (goal pinned), then the tool-less answer', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'big.txt'), 'z'.repeat(6000));
    const READ = { toolCalls: [{ name: 'read_file', arguments: '{"path":"big.txt"}' }] };
    srv = await fakeOpenAI({ script: [READ, READ, READ, { content: '## Goal\nread big.txt' }, { content: 'It is all z.' }] });
    const evs: Array<Record<string, unknown>> = [];
    await new Agent({ base: srv.base, model: 'm', profile: COMPAT_ALLOWLIST['llama.cpp']!, nativeTools: true, surface: 'full', cwd, roots: [cwd], maxSteps: 3, maxTokens: 256, contextTarget: 2048, emit: (e) => evs.push(e) }).prompt('what is in big.txt?');
    expect(evs.filter((e) => e.type === 'compaction_end')).toHaveLength(1);
    const final = srv.requests[4]!;
    expect(final.tools).toBeUndefined();
    const last = (final.messages as ChatMessage[]).at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toContain("The user's current request (verbatim):\nwhat is in big.txt?");
    expect(last.content.endsWith(STEP_LIMIT_PROMPT)).toBe(true);
    expect(evs.at(-1)).toMatchObject({ type: 'agent_end', stopReason: 'max_steps' });
    expect(evs.at(-1)).not.toHaveProperty('error');
  });
});
