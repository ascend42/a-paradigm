/**
 * A FAKE OpenAI-compatible / llama.cpp server, in process (node:http on
 * 127.0.0.1, ephemeral port). Never a real model. Shared by the gnomon-local
 * tests and the kernel's #local-runner tests.
 *
 *   GET  /health /props /slots /v1/models
 *   POST /v1/chat/completions — the capability probe's `get_time` request is
 *        answered from `tools` (a tool call iff tools); every other request
 *        consumes the next scripted reply (streamed as SSE when asked:
 *        content in 3 deltas, tool-call arguments split across 2 chunks,
 *        then a usage chunk and [DONE]); an exhausted script answers "done".
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeReply {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
}

export interface FakeServer {
  base: string;
  port: number;
  requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

export async function fakeOpenAI(o: { tools?: boolean; nCtx?: number; model?: string; script?: FakeReply[]; slots?: boolean } = {}): Promise<FakeServer> {
  const script = [...(o.script ?? [])];
  const requests: Array<Record<string, unknown>> = [];
  const model = o.model ?? 'fake-qwen-7b-q4';
  const json = (res: http.ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && req.url === '/props') return json(res, 200, { default_generation_settings: { n_ctx: o.nCtx ?? 8192 }, total_slots: 1, chat_template: o.tools ? '{% if tools %}…{% endif %}' : '' });
      if (req.method === 'GET' && req.url === '/slots') return o.slots === false ? json(res, 501, { error: 'slots disabled' }) : json(res, 200, [{ id: 0, n_ctx: o.nCtx ?? 8192 }]);
      if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { data: [{ id: model }] });
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: 'not found' });
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      const isProbe = Array.isArray(body.tools) && (body.tools as Array<{ function?: { name?: string } }>).some((t) => t.function?.name === 'get_time');
      const reply: FakeReply = isProbe ? (o.tools ? { toolCalls: [{ name: 'get_time', arguments: '{"tz":"UTC"}' }] } : { content: 'It is noon.' }) : (script.shift() ?? { content: 'done' });
      const calls = (reply.toolCalls ?? []).map((t, i) => ({ id: `call_${requests.length}_${i}`, type: 'function', function: { name: t.name, arguments: t.arguments } }));
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
      if (!body.stream) return json(res, 200, { choices: [{ message: { role: 'assistant', content: reply.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (c: unknown): boolean => res.write(`data: ${JSON.stringify(c)}\n\n`);
      const text = reply.content ?? '';
      const third = Math.ceil(text.length / 3) || 1;
      for (let i = 0; i < text.length; i += third) send({ choices: [{ index: 0, delta: { content: text.slice(i, i + third) } }] });
      calls.forEach((c, index) => {
        const half = Math.ceil(c.function.arguments.length / 2);
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments.slice(0, half) } }] } }] });
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: c.function.arguments.slice(half) } }] } }] });
      });
      send({ choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] });
      send({ choices: [], usage });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, requests, close: () => new Promise((r) => server.close(() => r())) };
}
