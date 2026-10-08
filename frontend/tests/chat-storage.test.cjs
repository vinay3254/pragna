const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/chat-storage.ts');
const moduleUnderTest = new Module(filename, module);
moduleUnderTest.paths = module.paths;
moduleUnderTest._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8') + '\nexport { mergeHistory };',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText, filename);
const { mergeHistory } = moduleUnderTest.exports;

const prompt = { id: 'prompt', role: 'user', content: 'Original prompt' };
const reply = { id: 'reply', role: 'assistant', content: 'Original reply' };
const old = { id: 'chat', updatedAt: '2026-10-07T10:00:00Z', messages: [prompt, reply] };
const edited = { ...old, historyRevision: 1, updatedAt: '2026-10-07T10:01:00Z', messages: [{ ...prompt, content: 'Edited prompt' }] };
const merge = (saved, incoming) => JSON.parse(mergeHistory(JSON.stringify([saved]), JSON.stringify([incoming]), []))[0];

test('editing replaces the prompt and removes responses from durable history', () => {
  assert.deepEqual(merge(old, edited).messages, edited.messages);
});

test('a stale tab saving later cannot restore replies discarded by an edit', () => {
  const stale = { ...old, updatedAt: '2026-10-07T10:02:00Z' };
  assert.deepEqual(merge(edited, stale), edited);
  assert.deepEqual(merge(stale, edited), edited);
});

test('a second edit replaces an earlier edited branch', () => {
  const second = { ...edited, historyRevision: 2, messages: [{ ...prompt, content: 'Second edit' }] };
  assert.deepEqual(merge(edited, second), second);
  assert.deepEqual(merge(second, edited), second);
});

test('new turns and streamed updates still merge within the edited branch', () => {
  const answered = { ...edited, updatedAt: '2026-10-07T10:02:00Z', messages: [...edited.messages, { ...reply, content: 'New reply' }] };
  assert.deepEqual(merge(edited, answered), answered);
  assert.deepEqual(merge(answered, edited), answered);
});
