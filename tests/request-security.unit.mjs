import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const redact = readFileSync(new URL('../src/redact.js', import.meta.url), 'utf8');
const wrapper = app.slice(app.indexOf('(() => {'), app.indexOf('  PRICES = {')).trim().replace(/,$/, ';');
const call = app.slice(app.indexOf('async function callDeepSeek('), app.indexOf('function InlineText('));

test('helper token follows the exact served origin, preserving Request headers', async () => {
  const sent = [];
  const ctx = vm.createContext({ URL, Headers, Request, location: { origin: 'http://127.0.0.1:8793', href: 'http://127.0.0.1:8793/' },
    __ABYSS_TOKEN: 'fixture-token', fetch: (url, init) => { sent.push({ url, init }); } });
  vm.runInContext(wrapper, ctx);
  await ctx.fetch(new Request('http://127.0.0.1:8793/mcp', { headers: { 'mcp-session-id': 'session' } }));
  assert.equal(sent[0].init.headers.get('x-abyss-token'), 'fixture-token');
  assert.equal(sent[0].init.headers.get('mcp-session-id'), 'session');
  assert.equal(sent[0].init.redirect, 'error');
  for (const url of ['http://127.0.0.1:8794/', 'http://127.0.0.1:8793@evil.example/', 'https://api.deepseek.com/chat/completions']) {
    await ctx.fetch(url);
    assert.equal(new Headers(sent.at(-1).init.headers).has('x-abyss-token'), false);
  }
});

function apiContext() {
  const sent = [];
  const ctx = vm.createContext({ TextDecoder, API_BASE: 'https://stand-in.invalid', fetch: async (_url, opts) => {
    sent.push(JSON.parse(opts.body));
    return new Response('data: [DONE]\n\n');
  } });
  vm.runInContext(redact + '\n' + call, ctx);
  return { ctx, sent };
}

test('request assembly scrubs pins, text attachments, tool results and assistant metadata without mutating history', async () => {
  const { ctx, sent } = apiContext();
  const secret = 'hunter2hunter2';
  const messages = [
    { role: 'system', content: 'PINNED: password=' + secret },
    { role: 'user', content: [{ type: 'text', text: 'password=' + secret }, { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] },
    { role: 'assistant', content: null, reasoning_content: 'password=' + secret,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_project', arguments: JSON.stringify({ pattern: 'password=' + secret, token: secret }) } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'password=' + secret },
  ];
  const before = JSON.stringify(messages);
  await ctx.callDeepSeek({ apiKey: 'stand-in', messages, model: 'stand-in', onDelta() {} });
  assert.ok(!JSON.stringify(sent[0]).includes(secret));
  assert.equal(JSON.parse(sent[0].messages[2].tool_calls[0].function.arguments).token, 'REDACTED');
  assert.equal(sent[0].messages[1].content[1].image_url.url, 'data:image/png;base64,fixture');
  assert.equal(JSON.stringify(messages), before);
});

test('the explicit scrub toggle preserves the request when disabled', async () => {
  const { ctx, sent } = apiContext();
  const messages = [{ role: 'user', content: 'password=hunter2hunter2' }];
  await ctx.callDeepSeek({ apiKey: 'stand-in', messages, model: 'stand-in', scrub: false, onDelta() {} });
  assert.deepEqual(sent[0].messages, messages);
});

test('project search reports file lines and states result caps', async () => {
  const source = app.slice(app.indexOf('searchProjectText = async'), app.indexOf('    /* ---- the verify loop'));
  let asked;
  const ctx = vm.createContext({ URL, encodeURIComponent, project: { root: '/fixture project' }, HELPER_URL: 'http://127.0.0.1:8793',
    fetch: async (url) => { asked = url; return { json: async () => ({ count: 200, hits: Array.from({ length: 200 }, (_, i) => ({ path: '/fixture/total.js', line: i + 1, text: 'export const total = 0;' })) }) }; } });
  vm.runInContext('const ' + source.trim().replace(/,$/, ';') + '\nglobalThis.search = searchProjectText;', ctx);
  const result = await ctx.search('total', true);
  assert.equal(new URL(asked).searchParams.get('path'), '/fixture project');
  assert.match(result, /references to "total": 200/);
  assert.match(result, /showing the first 60/);
  assert.match(result, /capped at 200/);
  assert.match(result, /total\.js:60:/);
  assert.doesNotMatch(result, /total\.js:61:/);
});

test('request history excludes current and legacy cost footers while keeping tool results', () => {
  const source = app.slice(app.indexOf('Tn = (h, z) =>'), app.indexOf('    sendMessage = async'));
  const ctx = vm.createContext({ i: { pinned: [] }, CHEATSHEET: '', MCP_CONTRACT_TEXT: '', todayIndiana: () => '2026-09-17', u: { verified: 'fixture' } });
  vm.runInContext('const ' + source.trim().replace(/,$/, ';') + '\nglobalThis.build = Tn;', ctx);
  const messages = ctx.build([
    { role: 'assistant', content: 'normal answer' },
    { role: 'assistant', content: 'display-only text', display: true },
    { role: 'assistant', content: '**Cost of that turn** old footer' },
    { role: 'tool', toolCallId: 'call_1', content: 'the actual tool result' },
  ], 'next question');
  assert.ok(!JSON.stringify(messages).includes('footer'));
  assert.ok(!JSON.stringify(messages).includes('display-only'));
  assert.ok(messages.some(m => m.content === 'normal answer'));
  assert.ok(messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_1'));
});

test('file proposals accept the taught heading and legacy filename but reject ordinary bold prose', () => {
  const source = app.slice(app.indexOf('function fileBlocks('), app.indexOf('\nfunction ', app.indexOf('function fileBlocks(') + 1));
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  for (const heading of ['### file: src/cart.js', '**src/cart.js**']) {
    const files = ctx.fileBlocks(heading + '\n```js\nexport const sum = () => 1;\n```');
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'src/cart.js');
    assert.equal(files[0].code, 'export const sum = () => 1;\n');
  }
  assert.equal(ctx.fileBlocks('**Here is the answer**\n```js\nexample\n```').length, 0);
});
