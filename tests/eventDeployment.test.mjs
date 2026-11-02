import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as viem from 'viem';
import { IDBFactory } from 'fake-indexeddb';
import * as jsxRuntime from 'react/jsx-runtime';
import ganache from 'ganache';
import { sepolia } from 'viem/chains';

const artifact = JSON.parse(fs.readFileSync('src/lib/generated/eventDeployment.json', 'utf8'));
const factoryCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const owner = '0xF3B45d905b159C17baC29A9Bb8F2a04c731218d8';
const hash = `0x${'1'.repeat(64)}`;
function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const result = { exports: {} };
  new Function('require', 'exports', output)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'viem') return viem;
    throw Error(`Unexpected dependency: ${name}`);
  }, result.exports);
  return result.exports;
}
function fixture() {
  globalThis.indexedDB = new IDBFactory();
  const store = load('src/lib/eventDeploymentStore.ts');
  let deployed = false;
  let sends = 0;
  let reads = 0;
  const operation = { nonce: 33085931018829054501371884077056n, maxFeePerGas: 10n, paymaster: token, signature: '0xdead' };
  let service;
  const publicClient = {
    getChainId: async () => 11155111,
    getCode: async ({ address }) => {
      reads++;
      return address === service.DEPLOYMENT_FACTORY ? factoryCode : deployed ? artifact.runtimeCode : undefined;
    },
    call: async () => ({}), readContract: async () => token,
  };
  const receipt = () => ({ sender: owner, nonce: '0x1a19a68afe20000000000000000', success: true, receipt: { status: 'success', transactionHash: hash } });
  const client = {
    chain: { id: 11155111 }, account: { address: owner }, getChainId: async () => 11155111,
    prepareUserOperation: async ({ calls }) => { assert.equal(calls[0].value, 0n); return operation; },
    estimateUserOperationGas: async () => ({ callGasLimit: 100n, verificationGasLimit: 200n, preVerificationGas: 50n, paymasterVerificationGasLimit: 10n, paymasterPostOpGasLimit: 1n }),
    sendUserOperation: async (op) => { assert.equal(op.signature, undefined); sends++; deployed = true; return hash; },
    waitForUserOperationReceipt: async () => receipt(), getUserOperationReceipt: async () => receipt(),
  };
  service = load('src/lib/eventDeployment.ts', { './smartAccount': { publicClient }, './jpyc': { JPYC_ADDRESS: token }, './generated/eventDeployment.json': artifact, './eventDeploymentStore': store });
  return { store, service, client, publicClient, operation, receipt, setDeployed: (value) => { deployed = value; }, counts: () => ({ sends, reads }) };
}
test('preflight checks sponsor and gas without signing, sending, or reserving storage', async () => {
  const f = fixture();
  const result = await f.service.prepareEventDeployment(f.client, owner);
  assert.equal(result.estimatedMaxFee, viem.formatEther(3610n));
  assert.equal(f.counts().sends, 0);
  assert.equal(await f.store.getDeploymentRecord(owner), null);
});
for (const failure of ['rpc', 'bundler', 'owner', 'factory', 'sponsor', 'estimate', 'simulation', 'storage']) test(`${failure} failure prevents deployment send`, async () => {
  const f = fixture();
  if (failure === 'rpc') f.publicClient.getChainId = async () => 1;
  if (failure === 'bundler') f.client.getChainId = async () => 1;
  if (failure === 'owner') f.client.account.address = token;
  if (failure === 'factory') f.publicClient.getCode = async () => '0x00';
  if (failure === 'sponsor') delete f.operation.paymaster;
  if (failure === 'estimate') f.client.estimateUserOperationGas = async () => { throw Error('gas rejected'); };
  if (failure === 'simulation') f.publicClient.call = async () => { throw Error('simulation rejected'); };
  if (failure === 'storage') globalThis.indexedDB = { open() { throw Error('storage unavailable'); } };
  await assert.rejects(f.service.deployEvent(f.client, owner, () => assert.fail('must not submit')));
  assert.equal(f.counts().sends, 0);
});
test('successful deployment verifies runtime and stores exact large nonce and transaction', async () => {
  const f = fixture();
  const result = await f.service.deployEvent(f.client, owner, (submitted) => assert.equal(submitted, hash));
  assert.equal(result.status, 'success');
  assert.equal(result.nonce, '33085931018829054501371884077056');
  assert.equal(result.transactionHash, hash);
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}));
  assert.equal(f.counts().sends, 1);
});
test('two callers sharing IndexedDB cannot both submit', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.deployEvent(f.client, owner, () => {}), f.service.deployEvent(f.client, owner, () => {})]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.counts().sends, 1);
});
test('lost send response remains locked and recovers from exact runtime without resending', async () => {
  const f = fixture();
  const send = f.client.sendUserOperation;
  f.client.sendUserOperation = async (op) => { await send(op); throw Error('response lost'); };
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}), /response lost/);
  assert.equal((await f.store.getDeploymentRecord(owner)).status, 'unknown');
  assert.equal((await f.store.getDeploymentRecord(owner)).operationHash, undefined);
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}));
  const recovered = await f.service.recoverEventDeployment(f.client, owner);
  assert.equal(recovered.deployed, true);
  assert.equal(recovered.record.status, 'success');
  assert.equal(f.counts().sends, 1);
});
test('unknown hashless result without deployed code is not unlocked', async () => {
  const f = fixture();
  f.client.sendUserOperation = async () => { throw Error('response lost'); };
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}));
  await assert.rejects(f.service.recoverEventDeployment(f.client, owner), /受付番号が不明/);
  assert.equal((await f.store.getDeploymentRecord(owner)).status, 'unknown');
});
for (const failure of ['nonce', 'sender', 'pending', 'runtime', 'token']) test(`recovery rejects ${failure} mismatch without sending again`, async () => {
  const f = fixture();
  f.client.waitForUserOperationReceipt = async () => { throw Error('timeout'); };
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}));
  f.setDeployed(false);
  f.client.getUserOperationReceipt = async () => {
    if (failure === 'pending') return null;
    const result = f.receipt();
    if (failure === 'nonce') result.nonce = '0x1a19a68afe20000000000000001';
    if (failure === 'sender') result.sender = token;
    return result;
  };
  if (failure === 'runtime') f.publicClient.getCode = async () => '0x00';
  if (failure === 'token') { f.setDeployed(true); f.publicClient.readContract = async () => owner; }
  await assert.rejects(f.service.recoverEventDeployment(f.client, owner));
  assert.equal((await f.store.getDeploymentRecord(owner)).status, 'unknown');
  assert.equal(f.counts().sends, 1);
});
test('confirmed receipt failure permits a fresh explicit preflight', async () => {
  const f = fixture();
  f.client.waitForUserOperationReceipt = async () => { f.setDeployed(false); return { ...f.receipt(), success: false }; };
  await assert.rejects(f.service.deployEvent(f.client, owner, () => {}), /失敗/);
  assert.equal((await f.store.getDeploymentRecord(owner)).status, 'failed');
  await f.service.prepareEventDeployment(f.client, owner);
});
test('existing exact deployment is discovered without any stored record or send', async () => {
  const f = fixture(); f.setDeployed(true);
  assert.equal((await f.service.recoverEventDeployment(f.client, owner)).deployed, true);
  await assert.rejects(f.service.prepareEventDeployment(f.client, owner), /設置済み/);
  assert.equal(f.counts().sends, 0);
});

function panelFixture() {
  const slots = []; let cursor = 0; let sends = 0;
  const useState = (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = value; }]; };
  const useRef = (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; };
  const useEffect = (effect, deps) => { const i = cursor++; if (!(i in slots) || deps.some((d, j) => d !== slots[i][j])) { slots[i] = deps; effect(); } };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { EventDeploymentPanel } = load('src/components/EventDeploymentPanel.tsx', {
    react: { useState, useRef, useEffect }, 'react/jsx-runtime': jsxRuntime,
    '@/hooks/useWallet': { useWallet: () => ({ smartAccountClient: {} }) },
    '@/lib/eventDeploymentStore': { getDeploymentRecord: async () => null },
    '@/lib/eventDeployment': { isEventOrganizer: (a) => a === owner, EVENT_DEPLOYMENT_ADDRESS: token, DEPLOYMENT_FACTORY: token,
      prepareEventDeployment: async () => ({ paymaster: token, estimatedMaxFee: '0.001' }),
      deployEvent: async () => { sends++; return { status: 'success' }; }, recoverEventDeployment: async () => ({ deployed: false, record: null }),
    },
  });
  const render = (address = owner) => {
    cursor = 0; const root = EventDeploymentPanel({ address }); const elements = [];
    const visit = (node) => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; elements.push(node); visit(node.props?.children); };
    visit(root);
    return { root, elements, button: (label) => elements.find((e) => e.type === 'button' && e.props.children === label) };
  };
  return { render, sends: () => sends };
}
test('organizer UI requires explicit confirmation and cancel invalidates a stale submit handler', async () => {
  const p = panelFixture(); p.render(); await Promise.resolve();
  await p.render().button('設置条件・スポンサーを事前確認（送信しません）').props.onClick();
  p.render().button('設置内容を確認する').props.onClick();
  assert.equal(p.sends(), 0);
  const stale = p.render().button('この内容でSepoliaに設置する').props.onClick;
  p.render().button('キャンセル').props.onClick(); await stale();
  assert.equal(p.sends(), 0);
  p.render().button('設置内容を確認する').props.onClick();
  const confirm = p.render().button('この内容でSepoliaに設置する').props.onClick;
  await Promise.all([confirm(), confirm()]);
  assert.equal(p.sends(), 1);
});
test('deployment controls are not shown for another wallet', () => {
  assert.equal(panelFixture().render(token).root, null);
});

test('generated artifact deploys via actual CREATE2 factory on a local Sepolia EVM', async () => {
  const f = fixture();
  const provider = ganache.provider({ chain: { chainId: 11155111, hardfork: 'shanghai' }, logging: { quiet: true } });
  try {
    const transport = viem.custom(provider);
    const rpc = viem.createPublicClient({ chain: sepolia, transport });
    const wallet = viem.createWalletClient({ chain: sepolia, transport });
    await provider.request({ method: 'evm_setAccountCode', params: [f.service.DEPLOYMENT_FACTORY, factoryCode] });
    await provider.request({ method: 'evm_setAccountCode', params: [token, '0x00'] });
    const [account] = await wallet.getAddresses();
    const tx = await wallet.sendTransaction({ account, to: f.service.DEPLOYMENT_FACTORY, data: viem.concatHex([f.service.deploymentPlan.salt, artifact.initCode]), gas: 8000000n });
    assert.equal((await rpc.waitForTransactionReceipt({ hash: tx })).status, 'success');
    assert.equal((await rpc.getCode({ address: f.service.EVENT_DEPLOYMENT_ADDRESS })).toLowerCase(), artifact.runtimeCode.toLowerCase());
    assert.equal((await rpc.readContract({ address: f.service.EVENT_DEPLOYMENT_ADDRESS, abi: viem.parseAbi(['function jpyc() view returns (address)']), functionName: 'jpyc' })).toLowerCase(), token.toLowerCase());
  } finally { await provider.disconnect(); }
});
