// A fake stdio MCP server for #local-mcp-client tests (TD-2026-10-27-833 slice C2'). Run as
// `node fake-mcp-server.mjs [pidfile]` (process.execPath on Windows: never a shebang).
// Tools: echo (read), poke (mutate), slow (never answers), crash (exits), big (an oversized line), change (sends
// notifications/tools/list_changed and adds tool `later`). Resource: fake://x/tool-annotations (op-annotations).
import * as fs from 'node:fs';

const pidfile = process.argv[2];
if (pidfile) fs.writeFileSync(pidfile, String(process.pid));
let changed = false;
let calls = 0;
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const tool = (name, description, extra = {}) => ({ name, description, inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, ...extra });
const tools = () => [
  tool('echo', 'Echo text back. Reads only.', { annotations: { readOnlyHint: true } }),
  tool('poke', 'Poke something.'),
  tool('slow', 'Never answers.', { annotations: { readOnlyHint: true } }),
  tool('crash', 'Exits the server.', { annotations: { readOnlyHint: true } }),
  tool('big', 'Answers with an oversized line.', { annotations: { readOnlyHint: true } }),
  tool('change', 'Changes the tool list.', { annotations: { readOnlyHint: true } }),
  { name: 'fam', description: 'Family. Ops: get(text), set(text).', inputSchema: { type: 'object', properties: { op: { type: 'string', enum: ['get', 'set'] }, text: { type: 'string' } }, required: ['op'] }, annotations: { readOnlyHint: true } },
  ...(changed ? [tool('later', 'Added after list_changed.', { annotations: { readOnlyHint: true } })] : []),
];
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id === undefined) {
      if (m.method === 'notifications/cancelled' && pidfile) fs.appendFileSync(`${pidfile}.cancelled`, `${m.params.requestId}\n`);
      continue;
    }
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true }, resources: {} }, serverInfo: { name: 'fake', version: '1' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: tools() } });
    else if (m.method === 'resources/list') send({ jsonrpc: '2.0', id: m.id, result: { resources: [{ uri: 'fake://x/readme', mimeType: 'text/plain', name: 'readme' }, { uri: 'fake://x/tool-annotations', mimeType: 'application/json', name: 'ann' }] } });
    else if (m.method === 'resources/read') send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: m.params.uri, mimeType: 'application/json', text: JSON.stringify({ schema: 'io.gnomon/op-annotations:v1', tools: { fam: { get: { readOnlyHint: true } } } }) }] } });
    else if (m.method === 'tools/call') {
      calls++;
      const n = m.params.name;
      const args = m.params.arguments ?? {};
      if (n === 'slow') continue;
      if (n === 'crash') process.exit(3);
      if (n === 'big') {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'x'.repeat(200_000) }] } })}\n`);
        continue;
      }
      if (n === 'change') {
        changed = true;
        send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      }
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `${n}:${JSON.stringify(args)}:${calls}` }] } });
    } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no such method' } });
  }
});
