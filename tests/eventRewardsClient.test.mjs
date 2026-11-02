import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as viem from 'viem';
import { IDBFactory } from 'fake-indexeddb';
import * as jsxRuntime from 'react/jsx-runtime';

const contract = '0x0000000000000000000000000000000000000011';
const owner = '0x0000000000000000000000000000000000000022';
const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const hash = `0x${'1'.repeat(64)}`;
function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'exports', 'process', output)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'viem') return viem;
    throw Error(`Unexpected import: ${name}`);
  }, loaded.exports, { env: { NEXT_PUBLIC_EVENT_REWARDS_ADDRESS: contract } });
  return loaded.exports;
}
function fixture(overrides = {}) {
  globalThis.indexedDB = new IDBFactory();
  const store = load('src/lib/eventRegistrationStore.ts');
  const state = { rpc: 11155111, bundler: 11155111, token, reward: 10n ** 18n, id: 0n, sponsor: contract, success: true, ...overrides };
  let sends = 0;
  let signature;
  const nonce = 33085931018829054501371884077056n;
  const publicClient = {
    getChainId: async () => state.rpc,
    readContract: async ({ functionName }) => ({ jpyc: state.token, reward: state.reward, certificateOf: state.id, registeredAt: 1700000000n })[functionName],
    simulateContract: async ({ account }) => assert.equal(account, owner),
  };
  const nftAbi = viem.parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);
  const jpycAbi = viem.parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const eventAbi = viem.parseAbi(['event Registered(address indexed participant, uint256 indexed tokenId, uint256 amount)']);
  const logs = [
    { address: token, topics: viem.encodeEventTopics({ abi: jpycAbi, eventName: 'Transfer', args: { from: contract, to: owner } }), data: viem.encodeAbiParameters([{ type: 'uint256' }], [10n ** 18n]) },
    { address: contract, topics: viem.encodeEventTopics({ abi: nftAbi, eventName: 'Transfer', args: { from: viem.zeroAddress, to: owner, tokenId: 1n } }), data: '0x' },
    { address: contract, topics: viem.encodeEventTopics({ abi: eventAbi, eventName: 'Registered', args: { participant: owner, tokenId: 1n } }), data: viem.encodeAbiParameters([{ type: 'uint256' }], [10n ** 18n]) },
  ];
  const receipt = () => ({ sender: owner, nonce: `0x${nonce.toString(16)}`, success: state.success, receipt: { status: state.success ? 'success' : 'reverted', transactionHash: hash, logs } });
  const client = {
    account: { address: owner }, getChainId: async () => state.bundler,
    prepareUserOperation: async ({ calls }) => {
      assert.equal(calls[0].to, contract); assert.equal(calls[0].value, 0n);
      return { paymaster: state.sponsor, signature: '0xdead', nonce };
    },
    estimateUserOperationGas: async () => ({}),
    sendUserOperation: async (operation) => { sends++; signature = operation.signature; return hash; },
    waitForUserOperationReceipt: async () => { if (state.success) state.id = 1n; return receipt(); },
    getUserOperationReceipt: async () => receipt(),
  };
  const api = load('src/lib/eventRewards.ts', { './smartAccount': { publicClient }, './jpyc': { JPYC_ADDRESS: token }, './eventRegistrationStore': store });
  return { api, client, publicClient, store, state, logs, receipt, sends: () => sends, signature: () => signature, saved: () => store.getRegistrationAttempt(contract, owner) };
}

test('event client requires sponsor and never falls back to self-funded submission', async () => {
  const f = fixture({ sponsor: viem.zeroAddress });
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /スポンサー/);
  assert.equal(f.sends(), 0); assert.equal((await f.saved()).status, 'failed');
});
for (const state of [{ rpc: 1 }, { bundler: 1 }, { token: contract }, { reward: 2n }]) test(`rejects invalid connection/configuration ${JSON.stringify(state, (_k, v) => typeof v === 'bigint' ? String(v) : v)}`, async () => {
  const f = fixture(state); await assert.rejects(f.api.registerForEvent(f.client, () => {})); assert.equal(f.sends(), 0);
});
test('existing registration returns without sending', async () => {
  const f = fixture({ id: 1n });
  assert.equal((await f.api.registerForEvent(f.client, () => {})).tokenId, '1'); assert.equal(f.sends(), 0);
});
test('verifies exact JPYC transfer, NFT mint and registration before reporting success', async () => {
  const f = fixture(); let submitted;
  assert.equal((await f.api.registerForEvent(f.client, (value) => { submitted = value; })).tokenId, '1');
  assert.equal(submitted, hash); assert.equal(f.sends(), 1); assert.equal(f.signature(), undefined);
  assert.equal((await f.saved()).status, 'success'); assert.equal((await f.saved()).transactionHash, hash);
});
for (const logIndex of [0, 1, 2]) test(`missing reward log ${logIndex} prevents immediate success`, async () => {
  const f = fixture(); f.logs.splice(logIndex, 1);
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /受取記録/);
  assert.equal((await f.saved()).status, 'unknown');
});
test('wrong JPYC amount prevents success', async () => {
  const f = fixture(); f.logs[0].data = viem.encodeAbiParameters([{ type: 'uint256' }], [1n]);
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /受取記録/);
});
test('reverted registration becomes retryable only after failure is confirmed', async () => {
  const f = fixture({ success: false });
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /失敗/);
  assert.equal((await f.saved()).status, 'failed'); f.state.success = true;
  assert.equal((await f.api.registerForEvent(f.client, () => {})).tokenId, '1');
});
for (const stage of ['simulation', 'estimate', 'storage', 'chain-recheck']) test(`${stage} failure stops before send`, async () => {
  const f = fixture();
  if (stage === 'simulation') f.publicClient.simulateContract = async () => { throw Error('insufficient JPYC'); };
  if (stage === 'estimate') f.client.estimateUserOperationGas = async () => { throw Error('sponsor rejected'); };
  if (stage === 'storage') globalThis.indexedDB = { open() { throw Error('storage blocked'); } };
  if (stage === 'chain-recheck') f.client.estimateUserOperationGas = async () => { f.state.bundler = 1; };
  await assert.rejects(f.api.registerForEvent(f.client, () => {})); assert.equal(f.sends(), 0);
});
test('two tabs sharing IndexedDB cannot both send', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.api.registerForEvent(f.client, () => {}), f.api.registerForEvent(f.client, () => {})]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(f.sends(), 1);
});
test('lost send response is recovered from atomic chain record without re-signing', async () => {
  const f = fixture();
  const send = f.client.sendUserOperation;
  f.client.sendUserOperation = async (op) => { await send(op); throw Error('response lost'); };
  await assert.rejects(f.api.registerForEvent(f.client, () => {}));
  assert.equal((await f.saved()).status, 'unknown');
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /結果未確認/);
  await assert.rejects(f.api.recoverEventRegistration(f.client), /受付番号/);
  f.state.id = 1n;
  assert.equal((await f.api.recoverEventRegistration(f.client)).tokenId, '1');
  assert.equal((await f.saved()).status, 'success'); assert.equal(f.sends(), 1);
});
test('timeout keeps persistent lock and pending receipt does not unlock it', async () => {
  const f = fixture();
  f.client.waitForUserOperationReceipt = async () => { throw Error('timeout'); };
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /timeout/);
  f.client.getUserOperationReceipt = async () => null;
  await assert.rejects(f.api.recoverEventRegistration(f.client), /未確定/);
  assert.equal((await f.saved()).operationHash, hash); assert.equal((await f.saved()).status, 'unknown');
  await assert.rejects(f.api.registerForEvent(f.client, () => {})); assert.equal(f.sends(), 1);
});
test('recovery of confirmed failure unlocks explicit retry without sending', async () => {
  const f = fixture(); f.client.waitForUserOperationReceipt = async () => { throw Error('timeout'); };
  await assert.rejects(f.api.registerForEvent(f.client, () => {}));
  f.state.success = false;
  await assert.rejects(f.api.recoverEventRegistration(f.client), /失敗/);
  assert.equal((await f.saved()).status, 'failed'); assert.equal(f.sends(), 1);
});
test('read-only recovery rejects mismatched nonce and keeps lock', async () => {
  const f = fixture(); f.client.waitForUserOperationReceipt = async () => { throw Error('timeout'); };
  await assert.rejects(f.api.registerForEvent(f.client, () => {}));
  f.client.getUserOperationReceipt = async () => ({ ...f.receipt(), nonce: '0x1' });
  await assert.rejects(f.api.recoverEventRegistration(f.client), /nonce/);
  assert.equal((await f.saved()).status, 'unknown'); assert.equal(f.sends(), 1);
});
test('registration reservations are isolated by wallet and event', async () => {
  const f = fixture();
  const r = { event: contract, owner, attemptId: 'one', startedAt: new Date().toISOString(), status: 'unknown' };
  await f.store.reserveRegistration(r);
  await assert.rejects(f.store.reserveRegistration({ ...r, attemptId: 'two' }));
  await f.store.reserveRegistration({ ...r, owner: token });
  await f.store.reserveRegistration({ ...r, event: token });
});

function formFixture(service = {}) {
  const slots = []; let cursor = 0; let sends = 0; let refreshed = 0;
  const useState = (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; };
  const useRef = (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; };
  const useEffect = (effect, deps) => { const i = cursor++; if (!(i in slots) || deps.some((d, j) => d !== slots[i][j])) { slots[i] = deps; effect(); } };
  const client = {};
  const Form = load('src/components/EventRegistrationForm.tsx', {
    react: { useState, useRef, useEffect }, 'react/jsx-runtime': jsxRuntime,
    '@/hooks/useWallet': { useWallet: () => ({ smartAccountClient: client }) },
    '@/lib/eventRegistrationStore': { getRegistrationAttempt: async () => service.attempt ?? null, blocksRegistration: (r) => r && r.status !== 'failed' },
    '@/lib/eventRewards': { EVENT_ADDRESS: contract,
      recoverEventRegistration: async () => service.recovery ?? null,
      registerForEvent: async (...args) => { sends++; return service.send(...args); },
    },
  }).EventRegistrationForm;
  const onRegistered = () => { refreshed++; };
  const render = () => {
    cursor = 0; const root = Form({ address: owner, onRegistered }); const elements = [];
    const visit = (n) => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return; elements.push(n); visit(n.props?.children); }; visit(root);
    return { elements, button: (label) => elements.find((e) => e.type === 'button' && e.props.children === label), text: elements.filter((e) => typeof e.props?.children === 'string').map((e) => e.props.children).join(' ') };
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const confirm = async () => {
    render(); await settle();
    render().elements.find((e) => e.type === 'input').props.onChange({ target: { value: 'はな' } });
    render().elements.find((e) => e.type === 'form').props.onSubmit({ preventDefault() {} });
  };
  return { render, settle, confirm, sends: () => sends, refreshed: () => refreshed };
}
test('form sends only after final confirmation and waits for verified rewards', async () => {
  let finish; const pending = new Promise((resolve) => { finish = resolve; });
  const p = formFixture({ send: async (_client, submitted) => { submitted(hash); await pending; return { tokenId: '1', registeredAt: '2026-11-02T04:00:00Z' }; } });
  await p.confirm(); assert.equal(p.sends(), 0);
  const click = p.render().button('この内容で参加登録して特典を受け取る').props.onClick;
  const request = click(); await click();
  assert.equal(p.sends(), 1); assert.doesNotMatch(p.render().text, /参加登録が完了しました/);
  finish(); await request;
  assert.match(p.render().text, /参加登録が完了しました/); assert.equal(p.refreshed(), 1);
});
test('reload restores existing registration and refreshes wallet/NFT panels without send', async () => {
  const p = formFixture({ recovery: { tokenId: '1', registeredAt: '2026-11-02T04:00:00Z' } });
  p.render(); await p.settle(); assert.match(p.render().text, /参加登録が完了しました/);
  assert.equal(p.sends(), 0); assert.equal(p.refreshed(), 1);
});
test('persisted unknown attempt blocks final registration after reload', async () => {
  const p = formFixture({ attempt: { status: 'unknown' } });
  await p.confirm(); assert.equal(p.render().button('登録内容を確認する').props.disabled, true);
  assert.equal(p.sends(), 0);
});
test('registration failure never shows completion', async () => {
  const p = formFixture({ send: async () => { throw Error('sponsor rejected'); } });
  await p.confirm(); await p.render().button('この内容で参加登録して特典を受け取る').props.onClick();
  assert.match(p.render().text, /sponsor rejected/); assert.doesNotMatch(p.render().text, /参加登録が完了しました/);
});
test('event NFT is read directly without waiting for Alchemy indexing', async () => {
  const requested = [];
  const api = load('src/lib/nft.ts', {
    './eventRewards': { EVENT_ADDRESS: contract },
    './smartAccount': { publicClient: { readContract: async ({ functionName }) => {
      requested.push(functionName);
      return { balanceOf: 1n, name: 'LIVE', symbol: 'LIVE', certificateOf: 1n, ownerOf: owner, tokenURI: 'data:application/json;base64,eyJuYW1lIjoiTElWRSJ9' }[functionName];
    } } },
  });
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url) => { assert.match(url, /^data:application\/json/); return { ok: true, json: async () => ({ name: 'LIVE', image: 'data:image/svg+xml;base64,PHN2Zy8+' }) }; };
  try {
    const result = await api.getErc721Tokens(contract, owner);
    assert.equal(result.tokens[0].tokenId, 1n); assert.equal(result.tokens[0].metadata.name, 'LIVE');
    assert.ok(!requested.includes('tokenOfOwnerByIndex'));
  } finally { globalThis.fetch = fetchBefore; }
});
