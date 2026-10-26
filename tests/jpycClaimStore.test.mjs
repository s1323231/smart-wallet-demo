import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { IDBFactory } from 'fake-indexeddb';

const source = ts.transpileModule(fs.readFileSync('src/lib/jpycClaimStore.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load() {
  const loaded = { exports: {} };
  new Function('exports', source)(loaded.exports);
  return loaded.exports;
}
function fixture() {
  globalThis.indexedDB = new IDBFactory();
  const store = load();
  const owner = '0x0000000000000000000000000000000000000011';
  const faucet = '0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5';
  const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
  const record = { key: store.claimKey(owner, faucet, token), owner, faucet, token, chainId: 11155111,
    attemptId: 'attempt-1', status: 'processing', startedAt: '2000-01-01T00:00:00.000Z', amount: '1000000000000000000', decimals: 18 };
  return { store, record };
}
test('IndexedDB atomically grants only one reservation to competing tabs', async () => {
  const { store, record } = fixture();
  const otherTab = load();
  const results = await Promise.allSettled([
    store.reserveClaim(record), otherTab.reserveClaim({ ...record, attemptId: 'attempt-2' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.ok(store.blocksClaim(await otherTab.getClaimRecord(record.key)));
});
test('fresh module after reload restores unknown hash, nonce and lock without TTL expiry', async () => {
  const { store, record } = fixture();
  await store.reserveClaim(record);
  await store.updateClaim(record, { status: 'unknown', operationHash: `0x${'1'.repeat(64)}`, nonce: '7', blockNumber: '100' });
  const reloaded = load();
  const restored = await reloaded.getClaimRecord(record.key);
  assert.equal(restored.status, 'unknown');
  assert.equal(restored.nonce, '7');
  assert.equal(restored.operationHash, `0x${'1'.repeat(64)}`);
  assert.equal(reloaded.blocksClaim(restored), true);
  await assert.rejects(reloaded.reserveClaim({ ...record, attemptId: 'attempt-2' }), /結果不明/);
  assert.equal('signature' in restored, false);
  assert.equal('privateKey' in restored, false);
});
test('unknown without hash remains locked across reload', async () => {
  const { store, record } = fixture();
  await store.reserveClaim(record);
  await store.updateClaim(record, { status: 'unknown' });
  const reloaded = load();
  assert.equal((await reloaded.getClaimRecord(record.key)).operationHash, undefined);
  await assert.rejects(reloaded.reserveClaim({ ...record, attemptId: 'other' }));
});
for (const status of ['success', 'failed']) test(`late unknown update cannot overwrite confirmed ${status}`, async () => {
  const { store, record } = fixture();
  await store.reserveClaim(record);
  await store.updateClaim(record, { status });
  await load().updateClaim(record, { status: 'unknown' });
  assert.equal((await store.getClaimRecord(record.key)).status, status);
});
test('old attempt cannot overwrite a newer reservation', async () => {
  const { store, record } = fixture();
  await store.reserveClaim(record);
  await store.updateClaim(record, { status: 'failed' });
  await store.reserveClaim({ ...record, attemptId: 'attempt-2' });
  await assert.rejects(store.updateClaim(record, { status: 'unknown' }), /変更/);
  assert.equal((await store.getClaimRecord(record.key)).attemptId, 'attempt-2');
});
test('invalid record aborts reservation rather than creating an unlocked record', async () => {
  const { store, record } = fixture();
  await assert.rejects(store.reserveClaim({ ...record, decimals: 6 }), /検証できません/);
  assert.equal(await store.getClaimRecord(record.key), null);
});
test('unavailable IndexedDB rejects read and reservation', async () => {
  const { store, record } = fixture();
  globalThis.indexedDB = { open() { throw Error('storage disabled'); } };
  await assert.rejects(store.getClaimRecord(record.key), /storage disabled/);
  await assert.rejects(store.reserveClaim(record), /storage disabled/);
});
