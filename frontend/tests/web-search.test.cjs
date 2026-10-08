const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => {
  const text = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { searchWeb, searchContext, sourceLinks } = require('../src/lib/web-search.ts');
const toolRouting = require('../src/lib/tool-routing.ts');
const { needsLiveSearch, needsTools } = toolRouting;
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const hit = { title: 'Official release', url: 'https://example.org/releases', snippet: 'Release information.' };

test('valid results reach the prompt with source links and a retrieval timestamp', async () => {
  global.fetch = async () => Response.json({ success: true, provider: 'ddgs', retrieved_at: '2026-10-07', results: [hit, hit] });
  const result = await searchWeb('latest release');
  assert.equal(result.success, true);
  assert.equal(result.results.length, 1);
  assert.match(searchContext(result), /2026-10-07/);
  assert.match(searchContext(result), /publication time/);
  assert.match(sourceLinks(result), /https:\/\/example.org\/releases/);
});

test('fake fallback success, empty results, and invalid links are rejected', async () => {
  for (const data of [
    { success: true, provider: 'fallback', results: [hit] },
    { success: true, results: [] },
    { success: false, results: [hit] },
    { success: true, results: [{ ...hit, url: 'javascript:alert(1)' }] },
    { success: true, results: [{ ...hit, snippet: 'Web search results for query' }] },
  ]) {
    global.fetch = async () => Response.json(data);
    assert.equal((await searchWeb('query')).success, false);
  }
});

test('network and server failures produce explicit failures', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await searchWeb('query')).success, false);
  global.fetch = async () => new Response('', { status: 503 });
  assert.equal((await searchWeb('query')).success, false);
});

test('timeouts and caller cancellation actually abort requests', async () => {
  let aborted = 0;
  global.fetch = (_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason); }, { once: true });
  });
  // Keep the process alive while testing AbortSignal.timeout's unref'd timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    assert.equal((await searchWeb('query', { timeoutMs: 10 })).success, false);
    const controller = new AbortController();
    const result = searchWeb('query', { signal: controller.signal });
    controller.abort();
    assert.equal((await result).error, 'Search cancelled.');
    assert.equal(aborted, 2);
  } finally { clearInterval(keepAlive); }
});

test('freshness overrides transformation wording and explicit requests always search', () => {
  for (const query of ['summarize the latest news', 'research Python releases', 'look up official documentation', 'verify online who is the president', 'search the web for weather']) {
    assert.equal(needsLiveSearch(query), true, query);
  }
  for (const query of ['hello', 'what is my girlfriend name?', 'write a Python function', 'what is the current time?', 'search my chats for Reshma']) {
    assert.equal(needsLiveSearch(query), false, query);
  }
});

test('completed searches avoid a redundant tool round while other actions still use tools', () => {
  assert.equal(needsTools('Search online for the latest release', true), false);
  assert.equal(needsTools('Search online for the latest release'), true);
  assert.equal(needsTools('Search online and create a PDF report', true), true);
});

let searchResult;
let searchedMessages = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const mocks = {
    '@/lib/agent-tools': { AGENT_TOOLS_SCHEMA: [], executeTool: async () => ({}), imageToImage: async () => ({}) },
    '@/lib/image-edit-routing': { resolveImageEdit: () => null },
    '@/lib/indianLanguages': { INDIAN_LANGUAGE_MAP: {} },
    '@/lib/modelDisplayNames': { getModelConfig: () => undefined },
    '@/lib/mcpClient': { getMcpToolSchemas: async () => [] },
    '@/lib/usageLog': { appendUsageEntry: () => {}, estimateTokens: () => 0 },
    '@/lib/web-search': { searchWeb: async query => { searchedMessages.push(query); return searchResult; }, searchContext, sourceLinks },
    '@/lib/tool-routing': toolRouting,
  };
  if (mocks[request]) return mocks[request];
  return originalLoad.call(this, request, parent, isMain);
};
// Compile the real route while substituting only external dependencies.
const routePath = path.join(root, 'src/app/api/chat/route.ts');
const routeModule = new Module(routePath, module);
routeModule.filename = routePath;
routeModule.paths = module.paths;
const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
routeModule._compile(compiled, routePath);
Module._load = originalLoad;
const { POST } = routeModule.exports;
function request(messages) {
  return { headers: new Headers(), signal: new AbortController().signal, json: async () => ({ messages, enableTools: false }) };
}

test('a search after an image actually runs, shows status, and returns linked sources', async () => {
  searchResult = { success: true, query: 'latest release', results: [hit] };
  searchedMessages = [];
  global.fetch = async () => new Response(JSON.stringify({ message: { content: 'Verified release information.' }, done: true }) + '\n');
  const response = await POST(request([
    { role: 'user', content: 'An old picture', images: ['data:image/png;base64,AAAA'] },
    { role: 'assistant', content: 'A picture.' },
    { role: 'user', content: 'Search the web for the latest release' },
  ]));
  const text = await response.text();
  assert.equal(searchedMessages.length, 1);
  assert.match(text, /Searching the web/);
  assert.match(text, /Verified release information/);
  assert.match(text, /https:\/\/example.org\/releases/);
});

test('failed live search stops before asking a model to guess', async () => {
  searchResult = { success: false, query: 'latest release', results: [], error: 'Live search unavailable. Please retry.' };
  let modelCalls = 0;
  global.fetch = async () => { modelCalls++; throw new Error('Model must not be called after failed search'); };
  const response = await POST(request([{ role: 'user', content: 'Search online for the latest release' }]));
  const text = await response.text();
  assert.equal(modelCalls, 0);
  assert.match(text, /Live search unavailable/);
  assert.match(text, /\[DONE\]/);
  assert.doesNotMatch(text, /could not get a response/);
});
