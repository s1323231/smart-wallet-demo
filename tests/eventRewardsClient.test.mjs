import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as viem from 'viem';

const contract = '0x0000000000000000000000000000000000000011';
const owner = '0x0000000000000000000000000000000000000022';
const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const hash = `0x${'1'.repeat(64)}`;
const output = ts.transpileModule(fs.readFileSync('src/lib/eventRewards.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(overrides = {}) {
  const state = { chain: 11155111, token, reward: 10n ** 18n, id: 0n, sponsor: contract, success: true, ...overrides };
  let sends = 0;
  let signature;
  const publicClient = {
    getChainId: async () => state.chain,
    readContract: async ({ functionName }) => ({ jpyc: state.token, reward: state.reward, certificateOf: state.id, registeredAt: 1700000000n })[functionName],
    simulateContract: async ({ account }) => assert.equal(account, owner),
  };
  const client = {
    account: { address: owner }, getChainId: async () => state.chain,
    prepareUserOperation: async ({ calls }) => {
      assert.equal(calls[0].to, contract);
      assert.equal(calls[0].value, 0n);
      return { paymaster: state.sponsor, signature: '0xdead' };
    },
    sendUserOperation: async (operation) => { sends++; signature = operation.signature; return hash; },
    waitForUserOperationReceipt: async () => {
      if (state.success) state.id = 1n;
      return { success: state.success, receipt: { status: state.success ? 'success' : 'reverted' } };
    },
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'process', output)(
    (name) => ({ viem, './smartAccount': { publicClient }, './jpyc': { JPYC_ADDRESS: token } })[name],
    loaded, loaded.exports, { env: { NEXT_PUBLIC_EVENT_REWARDS_ADDRESS: contract } },
  );
  return { api: loaded.exports, client, sends: () => sends, signature: () => signature };
}

test('event client requires a sponsor and never falls back to user-funded submission', async () => {
  const f = fixture({ sponsor: viem.zeroAddress });
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /スポンサー/);
  assert.equal(f.sends(), 0);
});
test('event client rejects the wrong network and token configuration', async () => {
  for (const state of [{ chain: 1 }, { token: contract }, { reward: 2n }]) {
    const f = fixture(state);
    await assert.rejects(f.api.registerForEvent(f.client, () => {}));
    assert.equal(f.sends(), 0);
  }
});
test('event client returns an existing registration without resending', async () => {
  const f = fixture({ id: 1n });
  assert.equal((await f.api.registerForEvent(f.client, () => {})).tokenId, '1');
  assert.equal(f.sends(), 0);
});
test('event client signs afresh, waits for success, then checks on-chain registration', async () => {
  const f = fixture();
  let submitted;
  const result = await f.api.registerForEvent(f.client, (value) => { submitted = value; });
  assert.equal(result.tokenId, '1');
  assert.equal(submitted, hash);
  assert.equal(f.sends(), 1);
  assert.equal(f.signature(), undefined);
});
test('event client never reports a reverted operation as received', async () => {
  const f = fixture({ success: false });
  await assert.rejects(f.api.registerForEvent(f.client, () => {}), /失敗/);
});
