import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';
import * as viem from 'viem';

function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'exports', output)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'viem') return viem;
    throw Error(`Unmocked import forbidden: ${name}`);
  }, loaded.exports);
  return loaded.exports;
}

function fixture() {
  globalThis.indexedDB = new IDBFactory();
  globalThis.BroadcastChannel = class { postMessage() {} close() {} };
  const calls = { network: 0, sign: 0, send: 0, receipts: 0, chains: 0 };
  const forbidden = (kind) => () => { calls[kind]++; throw Error(`Forbidden ${kind}`); };
  globalThis.fetch = forbidden('network');
  // 実RPC/Providerを生成せず、許可した読み取り以外は即座に失敗させる。
  const publicClient = new Proxy({}, { get: (_target, name) => name === 'getChainId'
    ? async () => { calls.chains++; return 11155111; }
    : forbidden('network') });
  const client = {
    getChainId: async () => { calls.chains++; return 11155111; },
    getUserOperationReceipt: async () => { calls.receipts++; return null; },
    signUserOperation: forbidden('sign'),
    signMessage: forbidden('sign'),
    sendUserOperation: forbidden('send'),
    sendTransaction: forbidden('send'),
  };
  const store = load('src/lib/jpycClaimStore.ts');
  const owner = '0x0000000000000000000000000000000000000011';
  const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
  const mocks = { './smartAccount': { publicClient }, './jpyc': { JPYC_ADDRESS: token }, './erc20': { ERC20_ABI: [] }, './jpycClaimStore': store };
  const faucet = load('src/lib/jpycFaucet.ts', mocks);
  const record = { key: store.claimKey(owner, faucet.JPYC_FAUCET_ADDRESS, token), owner,
    faucet: faucet.JPYC_FAUCET_ADDRESS, token, chainId: 11155111, attemptId: 'saved-attempt',
    startedAt: '2000-01-01T00:00:00.000Z', amount: '1000000000000000000', decimals: 18, status: 'processing' };
  const reload = () => {
    const storage = load('src/lib/jpycClaimStore.ts');
    return { store: storage, faucet: load('src/lib/jpycFaucet.ts', { ...mocks, './jpycClaimStore': storage }) };
  };
  return { calls, store, faucet, record, owner, client, reload };
}

for (const status of ['processing', 'unknown']) test(`persisted ${status} blocks acquisition before any RPC/sign/send after reload`, async () => {
  const f = fixture();
  await f.store.reserveClaim(f.record);
  if (status === 'unknown') await f.store.updateClaim(f.record, { status });
  const reloaded = f.reload();
  await assert.rejects(reloaded.faucet.claimJpyc(f.client, f.owner, () => assert.fail('must not submit'), () => true), /処理中または結果不明/);
  assert.equal((await reloaded.store.getClaimRecord(f.record.key)).status, status);
  assert.deepEqual(f.calls, { network: 0, sign: 0, send: 0, receipts: 0, chains: 0 });
});

test('recovery without hash keeps actual IndexedDB lock and never signs or sends', async () => {
  const f = fixture();
  await f.store.reserveClaim(f.record);
  await f.store.updateClaim(f.record, { status: 'unknown' });
  const reloaded = f.reload();
  await assert.rejects(reloaded.faucet.recoverJpycClaim(f.client, f.owner), /ハッシュ不明/);
  await assert.rejects(reloaded.store.reserveClaim({ ...f.record, attemptId: 'retry' }));
  assert.equal((await reloaded.store.getClaimRecord(f.record.key)).status, 'unknown');
  assert.deepEqual(f.calls, { network: 0, sign: 0, send: 0, receipts: 0, chains: 2 });
});

test('unconfirmed mocked receipt preserves hash/lock across repeated recovery without resending', async () => {
  const f = fixture();
  const operationHash = `0x${'1'.repeat(64)}`;
  await f.store.reserveClaim(f.record);
  await f.store.updateClaim(f.record, { status: 'unknown', operationHash, nonce: '3', blockNumber: '100' });
  const reloaded = f.reload();
  for (let i = 0; i < 2; i++) await assert.rejects(reloaded.faucet.recoverJpycClaim(f.client, f.owner), /未確定/);
  const saved = await reloaded.store.getClaimRecord(f.record.key);
  assert.equal(saved.operationHash, operationHash);
  assert.equal(saved.status, 'unknown');
  await assert.rejects(reloaded.faucet.claimJpyc(f.client, f.owner, () => assert.fail('must not submit'), () => true));
  assert.deepEqual(f.calls, { network: 0, sign: 0, send: 0, receipts: 2, chains: 4 });
});
