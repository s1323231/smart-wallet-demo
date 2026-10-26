import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as viem from 'viem';
import * as jsxRuntime from 'react/jsx-runtime';
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.BroadcastChannel = class { postMessage() {} close() {} };
const owner = '0x0000000000000000000000000000000000000011';
const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const hash = `0x${'1'.repeat(64)}`;
function load(file, mocks) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => mocks[name] ?? (name === 'viem' ? viem : undefined), loaded, loaded.exports);
  return loaded.exports;
}
function fixture(overrides = {}) {
  const state = { token, paused: false, whitelistEnabled: false, isWhitelisted: false, getLimits: [86400n, 3000000n * 10n ** 18n, 1000000n * 10n ** 18n], getFaucetBalance: 10n ** 20n, lastAccessTime: 0n, balanceOf: 0n, decimals: 18, ...overrides };
  let sends = 0;
  let simulated = 0;
  let estimates = 0;
  let submittedSignature;
  const operation = { sender: owner, callData: '0x', nonce: 0n, paymaster: '0x0000000000000000000000000000000000000022', signature: '0xdead' };
  const publicClient = {
    getChainId: async () => 11155111,
    getBlock: async () => ({ number: 1n, timestamp: 1000n }),
    readContract: async ({ functionName }) => state[functionName],
    simulateContract: async (args) => {
      simulated++;
      assert.equal(args.account, owner);
      assert.deepEqual(args.args, [owner, 10n ** 18n]);
    },
  };
  const jpyc = load('src/lib/jpyc.ts', { './smartAccount': { publicClient }, './erc20': {} });
  let record = null;
  const storage = {
    blocksClaim: (r) => r?.status === 'processing' || r?.status === 'unknown',
    claimKey: (o, f, t) => `11155111:${o.toLowerCase()}:${f.toLowerCase()}:${t.toLowerCase()}`,
    getClaimRecord: async () => record,
    reserveClaim: async (r) => { if (storage.blocksClaim(record)) throw Error('pending claim'); record = structuredClone(r); },
    updateClaim: async (r, changes) => { if (record.attemptId !== r.attemptId) throw Error('wrong attempt'); if (!['success', 'failed'].includes(record.status)) record = { ...record, ...changes }; return record; },
  };
  const faucet = load('src/lib/jpycFaucet.ts', { './smartAccount': { publicClient }, './jpyc': jpyc, './erc20': { ERC20_ABI: [] }, './jpycClaimStore': storage });
  const log = { address: token, topics: viem.encodeEventTopics({ abi: viem.parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']), eventName: 'Transfer', args: { from: faucet.JPYC_FAUCET_ADDRESS, to: owner } }), data: viem.encodeAbiParameters([{ type: 'uint256' }], [10n ** 18n]) };
  const client = {
    getChainId: async () => 11155111,
    chain: { id: 11155111 }, account: { address: owner },
    prepareUserOperation: async ({ calls }) => {
      const decoded = viem.decodeFunctionData({ abi: faucet.FAUCET_ABI, data: calls[0].data });
      assert.equal(calls[0].to, faucet.JPYC_FAUCET_ADDRESS);
      assert.deepEqual(decoded.args, [owner, 10n ** 18n]);
      return operation;
    },
    estimateUserOperationGas: async () => { estimates++; },
    sendUserOperation: async (args) => { sends++; submittedSignature = args.signature; return hash; },
    waitForUserOperationReceipt: async () => ({ success: true, sender: owner, nonce: 0n, receipt: { blockNumber: 1n, status: 'success', transactionHash: hash, logs: [log] } }),
  };
  client.getUserOperationReceipt = () => client.waitForUserOperationReceipt();
  return { faucet, client, operation, publicClient, log, storage, getRecord: () => record, counts: () => ({ sends, simulated, estimates, submittedSignature }) };
}
for (const [name, overrides, message] of [
  ['wrong token', { token: owner }, /配布トークン/],
  ['paused', { paused: true }, /一時停止/],
  ['whitelist', { whitelistEnabled: true }, /許可リスト/],
  ['cooldown', { lastAccessTime: 900n }, /次回取得/],
  ['balance limit', { balanceOf: 1000001n * 10n ** 18n }, /残高上限/],
  ['amount limit', { getLimits: [1n, 0n, 10n ** 20n] }, /取得上限/],
  ['empty faucet', { getFaucetBalance: 0n }, /残高が不足/],
]) test(`blocks ${name} without sending`, async () => {
  const f = fixture(overrides);
  await assert.rejects(f.faucet.prepareJpycClaim(f.client, owner), message);
  assert.equal(f.counts().sends, 0);
});
test('preflight simulates and estimates, without sending', async () => {
  const f = fixture();
  await f.faucet.prepareJpycClaim(f.client, owner);
  assert.deepEqual(f.counts(), { sends: 0, simulated: 1, estimates: 1, submittedSignature: undefined });
});
test('requires sponsor', async () => {
  const f = fixture(); delete f.operation.paymaster;
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /スポンサー/);
  assert.equal(f.counts().sends, 0);
});
test('stops when AA estimation rejects', async () => {
  const f = fixture(); f.client.estimateUserOperationGas = async () => { throw Error('AA simulation rejected'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /AA simulation/);
  assert.equal(f.counts().sends, 0);
});
test('checks connected owner and chain', async () => {
  const f = fixture(); f.client.chain.id = 1;
  await assert.rejects(f.faucet.prepareJpycClaim(f.client, owner), /Sepolia/);
  f.client.chain.id = 11155111;
  await assert.rejects(f.faucet.prepareJpycClaim(f.client, token), /Smart Account/);
});
test('strips stub signature and verifies receipt transfer before returning', async () => {
  const f = fixture(); let submitted;
  assert.equal(await f.faucet.claimJpyc(f.client, owner, (hash) => { submitted = hash; }, () => true), hash);
  assert.equal(submitted, hash);
  assert.equal(f.counts().submittedSignature, undefined);
  assert.equal(f.counts().sends, 1);
});
test('failed UserOperation never returns success', async () => {
  const f = fixture(); f.client.waitForUserOperationReceipt = async () => ({ success: false, sender: owner, nonce: 0n, receipt: { status: 'success', transactionHash: hash } });
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /失敗/);
});
test('missing transfer never returns success', async () => {
  const f = fixture(); f.client.waitForUserOperationReceipt = async () => ({ success: true, sender: owner, nonce: 0n, receipt: { status: 'success', blockNumber: 1n, logs: [] } });
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /受取記録を確認できません/);
});

test('missing consent prevents any claim preparation or sending', async () => {
  const f = fixture();
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => false), /同意/);
  assert.equal(f.counts().simulated, 0);
  assert.equal(f.counts().sends, 0);
});

test('consent revoked during async revalidation prevents signing and sending', async () => {
  const f = fixture();
  let consent = true;
  const estimate = f.client.estimateUserOperationGas;
  f.client.estimateUserOperationGas = async () => { await estimate(); consent = false; };
  let notified = false;
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => { notified = true; }, () => consent), /署名・送信を中止/);
  assert.equal(f.counts().estimates, 1);
  assert.equal(f.counts().sends, 0);
  assert.equal(notified, false);
});

// Hook状態とイベントを使って画面の操作を検証。DOMや追加依存は不要。
function panelFixture(service = {}) {
  const slots = [];
  let cursor = 0;
  let prepares = 0;
  let claims = 0;
  const useState = (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
  };
  const useRef = (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: initial };
    return slots[i];
  };
  const useEffect = (effect, dependencies) => {
    const i = cursor++;
    if (!(i in slots) || dependencies.some((d, index) => d !== slots[i][index])) { slots[i] = dependencies; effect(); }
  };
  const { JpycFaucet } = load('src/components/JpycFaucet.tsx', {
    react: { useState, useRef, useEffect }, 'react/jsx-runtime': jsxRuntime,
    '@/lib/jpyc': { JPYC_ADDRESS: token },
    '@/lib/jpycClaimStore': { claimKey: () => owner, getClaimRecord: async () => service.record ?? null, blocksClaim: (r) => r?.status === 'processing' || r?.status === 'unknown' },
    '@/hooks/useWallet': { useWallet: () => ({ smartAccountClient: {} }) },
    '@/lib/jpycFaucet': {
      recoverJpycClaim: async () => { if (service.recover) return service.recover(); return service.record ?? null; },
      JPYC_FAUCET_ADDRESS: '0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5',
      prepareJpycClaim: async () => {
        prepares++;
        if (service.prepare) return service.prepare();
        return { interval: '86400', amountLimit: '3000000', balanceLimit: '1000000', faucetBalance: '100', paymaster: '0x0000000000000000000000000000000000000022' };
      },
      claimJpyc: async (...args) => { claims++; return service.claim?.(...args); },
    },
  });
  const render = () => {
    cursor = 0;
    const root = JpycFaucet({ address: owner, onReceived: async () => {} });
    const elements = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      elements.push(node);
      visit(node.props?.children);
    };
    visit(root);
    return {
      inputs: elements.filter((e) => e.type === 'input'),
      buttons: elements.filter((e) => e.type === 'button'),
      dialog: elements.find((e) => e.props?.role === 'dialog'),
      elements,
      status: elements.find((e) => e.props?.role === 'status').props.children,
    };
  };
  const agree = (index, checked) => render().inputs[index].props.onChange({ target: { checked } });
  const confirm = () => {
    render().buttons[1].props.onClick();
    return render().buttons[2].props.onClick();
  };
  return { render, agree, confirm, counts: () => ({ prepares, claims }) };
}

async function mountedPanel(service) {
  const p = panelFixture(service);
  p.render();
  await Promise.resolve();
  return p;
}

test('preflight works without consent; consent changes retain its result', async () => {
  const p = await mountedPanel();
  assert.equal(p.render().buttons[0].props.disabled, false);
  assert.equal(p.render().buttons[1].props.disabled, true);
  await p.render().buttons[0].props.onClick();
  assert.equal(p.counts().prepares, 1);
  assert.match(p.render().status, /事前確認が通りました/);
  for (let i = 0; i < 2; i++) p.agree(i, true);
  assert.equal(p.render().buttons[1].props.disabled, true);
  // Handler自体も未同意の取得を拒否する。
  await p.render().buttons[1].props.onClick();
  assert.equal(p.counts().claims, 0);
  p.agree(2, true);
  assert.equal(p.render().buttons[1].props.disabled, false);
  p.agree(0, false);
  assert.equal(p.render().buttons[1].props.disabled, true);
  p.agree(0, true);
  assert.equal(p.render().buttons[1].props.disabled, false);
  assert.equal(p.counts().prepares, 1);
});

for (const stage of ['preflight', 'before-send', 'after-send']) {
  test(`panel distinguishes ${stage} failure without success display`, async () => {
    const p = await mountedPanel({
      prepare: stage === 'preflight' ? async () => { throw Error('test failure'); } : undefined,
      claim: async (_client, _owner, onSubmitted, hasConsent) => {
        assert.equal(hasConsent(), true);
        if (stage === 'after-send') onSubmitted(hash);
        throw Error('test failure');
      },
    });
    await p.render().buttons[0].props.onClick();
    if (stage !== 'preflight') {
      for (let i = 0; i < 3; i++) p.agree(i, true);
      await p.confirm();
    }
    assert.match(p.render().status, stage === 'preflight' ? /事前確認に失敗/ : stage === 'before-send' ? /送信前に失敗/ : /送信後の結果を確認できません/);
    assert.doesNotMatch(p.render().status, /受取を確認しました/);
  });
}

test('panel passes live consent getter across asynchronous claim work', async () => {
  let finishRevalidation;
  const revalidation = new Promise((resolve) => { finishRevalidation = resolve; });
  const p = await mountedPanel({ claim: async (_client, _owner, _onSubmitted, hasConsent) => {
    await revalidation;
    assert.equal(hasConsent(), false);
    throw Error('同意を確認できないため、署名・送信を中止しました。');
  } });
  await p.render().buttons[0].props.onClick();
  for (let i = 0; i < 3; i++) p.agree(i, true);
  const claiming = p.confirm();
  p.agree(0, false);
  finishRevalidation();
  await claiming;
  assert.match(p.render().status, /同意を確認できない/);
  assert.equal(p.render().inputs[0].props.checked, false);
});

test('panel waits for verified receipt before showing success', async () => {
  let confirmReceipt;
  const receipt = new Promise((resolve) => { confirmReceipt = resolve; });
  const p = await mountedPanel({ claim: async (_client, _owner, onSubmitted) => {
    onSubmitted(hash);
    await receipt;
    return hash;
  } });
  await p.render().buttons[0].props.onClick();
  for (let i = 0; i < 3; i++) p.agree(i, true);
  const claiming = p.confirm();
  assert.match(p.render().status, /受取を確認しています/);
  assert.doesNotMatch(p.render().status, /受取を確認しました/);
  confirmReceipt();
  await claiming;
  assert.match(p.render().status, /取引の成功と、このSmart Account宛てのJPYC受取を確認しました/);
});

test('submission-start callback follows revalidation and consent checks', async () => {
  const f = fixture();
  let started = false;
  const send = f.client.sendUserOperation;
  f.client.sendUserOperation = async (args) => { assert.equal(started, true); return send(args); };
  await f.faucet.claimJpyc(f.client, owner, () => {}, () => true, () => {
    assert.equal(f.counts().estimates, 1);
    assert.equal(f.counts().sends, 0);
    started = true;
  });
});

test('panel does not claim a send error means nothing was broadcast', async () => {
  const p = await mountedPanel({ claim: async (_client, _owner, _onSubmitted, _hasConsent, onSubmissionStarted) => {
    onSubmissionStarted();
    throw Error('RPC timeout');
  } });
  await p.render().buttons[0].props.onClick();
  for (let i = 0; i < 3; i++) p.agree(i, true);
  await p.confirm();
  assert.match(p.render().status, /送信された可能性/);
  assert.doesNotMatch(p.render().status, /送信前に失敗/);
});

async function readyPanel(service) {
  const p = await mountedPanel(service);
  await p.render().buttons[0].props.onClick();
  for (let i = 0; i < 3; i++) p.agree(i, true);
  return p;
}

function dialogText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(dialogText).join(' ');
  return node?.props ? dialogText(node.props.children) : '';
}

test('acquire only opens final confirmation with actual details, without claiming', async () => {
  const p = await readyPanel();
  p.render().buttons[1].props.onClick();
  const text = dialogText(p.render().dialog);
  for (const expected of ['Ethereum Sepolia', owner, '1 JPYC', '0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5', 'sendToken', '0 ETH', '0x0000000000000000000000000000000000000022']) {
    assert.ok(text.includes(expected), expected);
  }
  assert.match(text, /スポンサー応答・ガス見積もり成功/);
  assert.equal(p.counts().claims, 0);
});

test('cancel closes confirmation without invoking acquisition, including stale confirm handler', async () => {
  const p = await readyPanel();
  p.render().buttons[1].props.onClick();
  const confirm = p.render().buttons[2].props.onClick;
  p.render().buttons[3].props.onClick();
  assert.equal(p.render().dialog, undefined);
  await confirm();
  assert.equal(p.counts().claims, 0);
  assert.equal(p.render().buttons[1].props.disabled, false);
});

test('unknown sponsor is displayed as unknown, never inferred from preflight completion', async () => {
  const p = await readyPanel({ prepare: async () => ({ interval: '86400', amountLimit: '10', balanceLimit: '10', faucetBalance: '10' }) });
  p.render().buttons[1].props.onClick();
  const text = dialogText(p.render().dialog);
  assert.match(text, /未確認/);
  assert.doesNotMatch(text, /スポンサー応答・ガス見積もり成功/);
  assert.equal(p.counts().claims, 0);
});

test('only explicit confirmation starts acquisition and repeated confirmation cannot send twice', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const p = await readyPanel({ claim: async () => { await pending; throw Error('pre-send rejection'); } });
  p.render().buttons[1].props.onClick();
  const confirm = p.render().buttons[2].props.onClick;
  assert.equal(p.counts().claims, 0);
  const claiming = confirm();
  await confirm();
  assert.equal(p.counts().claims, 1);
  assert.equal(p.render().dialog, undefined);
  assert.equal(p.render().buttons[1].props.disabled, true);
  finish();
  await claiming;
  await confirm();
  assert.equal(p.counts().claims, 1);
});

test('uncertain submission blocks subsequent preflight and acquisition attempts', async () => {
  const p = await readyPanel({ claim: async (_client, _owner, _submitted, _consent, started) => {
    started();
    throw Error('RPC timeout');
  } });
  await p.confirm();
  assert.match(p.render().status, /送信された可能性/);
  assert.equal(p.render().buttons[0].props.disabled, true);
  assert.equal(p.render().buttons[1].props.disabled, true);
  await p.render().buttons[0].props.onClick();
  await p.render().buttons[1].props.onClick();
  assert.equal(p.counts().claims, 1);
  assert.equal(p.counts().prepares, 1);
  assert.equal(p.render().dialog, undefined);
});

test('consent revoked while confirmation is open prevents acquisition', async () => {
  const p = await readyPanel();
  p.render().buttons[1].props.onClick();
  p.agree(0, false);
  assert.equal(p.render().buttons[2].props.disabled, true);
  await p.render().buttons[2].props.onClick();
  assert.equal(p.counts().claims, 0);
  assert.match(p.render().status, /同意/);
});

for (const side of ['rpc', 'bundler']) test(`rejects actual ${side} chain mismatch before sending`, async () => {
  const f = fixture();
  (side === 'rpc' ? f.publicClient : f.client).getChainId = async () => 1;
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /チェーンID/);
  assert.equal(f.counts().sends, 0);
});
test('chain RPC error never falls back to configuration', async () => {
  const f = fixture();
  f.client.getChainId = async () => { throw Error('network unavailable'); };
  await assert.rejects(f.faucet.prepareJpycClaim(f.client, owner), /network unavailable/);
  assert.equal(f.counts().sends, 0);
});
test('rechecks chains after async preparation before signature', async () => {
  const f = fixture();
  f.client.estimateUserOperationGas = async () => { f.client.getChainId = async () => 1; };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /チェーンID/);
  assert.equal(f.counts().sends, 0);
});
for (const decimals of [6, 0, 19]) test(`decimals ${decimals} rejected before sending`, async () => {
  const f = fixture({ decimals });
  await assert.rejects(f.faucet.prepareJpycClaim(f.client, owner), /decimals/);
});
for (const change of ['token', 'from', 'to', 'less', 'more', 'decimals']) test(`strict receipt rejects wrong ${change}`, () => {
  const f = fixture();
  const log = { ...f.log };
  if (change === 'token') log.address = owner;
  if (change === 'from' || change === 'to') log.topics = viem.encodeEventTopics({
    abi: viem.parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']), eventName: 'Transfer',
    args: { from: change === 'from' ? token : f.faucet.JPYC_FAUCET_ADDRESS, to: change === 'to' ? token : owner },
  });
  if (change === 'less' || change === 'more') log.data = viem.encodeAbiParameters([{ type: 'uint256' }], [10n ** 18n + (change === 'less' ? -1n : 1n)]);
  assert.throws(() => f.faucet.verifyFaucetTransfer({ status: 'success', logs: [log] }, owner, change === 'decimals' ? 6 : 18));
});
test('strict receipt sums only matching Faucet transfers to exactly 1 JPYC', () => {
  const f = fixture();
  const half = { ...f.log, data: viem.encodeAbiParameters([{ type: 'uint256' }], [5n * 10n ** 17n]) };
  f.faucet.verifyFaucetTransfer({ status: 'success', logs: [half, half] }, owner, 18);
});
test('unknown broadcast without hash remains locked and recovery never sends', async () => {
  const f = fixture();
  f.client.sendUserOperation = async () => { throw Error('response lost'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /response lost/);
  assert.equal(f.getRecord().status, 'unknown');
  assert.equal(f.getRecord().operationHash, undefined);
  await assert.rejects(f.faucet.recoverJpycClaim(f.client, owner), /ハッシュ不明/);
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /pending/);
});
test('receipt timeout preserves hash and recovery confirms exact receipt', async () => {
  const f = fixture();
  const valid = f.client.waitForUserOperationReceipt;
  f.client.waitForUserOperationReceipt = async () => { throw Error('timeout'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /timeout/);
  assert.equal(f.getRecord().status, 'unknown');
  assert.equal(f.getRecord().operationHash, hash);
  f.client.getUserOperationReceipt = async () => null;
  await assert.rejects(f.faucet.recoverJpycClaim(f.client, owner), /未確定/);
  assert.equal(f.getRecord().status, 'unknown');
  f.client.getUserOperationReceipt = valid;
  assert.equal((await f.faucet.recoverJpycClaim(f.client, owner)).status, 'success');
  assert.equal(f.counts().sends, 1);
});
test('receipt mismatch remains unknown and blocks subsequent claim', async () => {
  const f = fixture(); f.log.address = owner;
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /正確な1/);
  assert.equal(f.getRecord().status, 'unknown');
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /pending/);
});
test('verified failed operation becomes failed, never unknown or success', async () => {
  const f = fixture();
  f.client.waitForUserOperationReceipt = async () => ({ sender: owner, nonce: 0n, success: false, receipt: { status: 'success', transactionHash: hash } });
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /失敗/);
  assert.equal(f.getRecord().status, 'failed');
});
test('storage reservation failure stops all sending', async () => {
  const f = fixture(); f.storage.reserveClaim = async () => { throw Error('IDB unavailable'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /IDB unavailable/);
  assert.equal(f.counts().sends, 0);
});
test('sponsor fields persist in outgoing operation without fallback', async () => {
  const f = fixture();
  Object.assign(f.operation, { paymasterData: '0x1234', paymasterVerificationGasLimit: 100n, paymasterPostOpGasLimit: 200n });
  const send = f.client.sendUserOperation;
  f.client.sendUserOperation = async (operation) => {
    assert.equal(operation.paymaster, f.operation.paymaster);
    assert.equal(operation.paymasterData, '0x1234');
    assert.equal(operation.paymasterVerificationGasLimit, 100n);
    assert.equal(operation.paymasterPostOpGasLimit, 200n);
    return send(operation);
  };
  await f.faucet.claimJpyc(f.client, owner, () => {}, () => true);
});
test('persisted pending claim blocks a newly mounted panel', async () => {
  const p = await mountedPanel({ record: { status: 'unknown', operationHash: hash } });
  assert.equal(p.render().buttons[0].props.disabled, true);
  assert.equal(p.render().buttons[1].props.disabled, true);
  await p.render().buttons[0].props.onClick();
  assert.equal(p.counts().prepares, 0);
});

test('two claim callers sharing storage cannot both send', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.faucet.claimJpyc(f.client, owner, () => {}, () => true),
    f.faucet.claimJpyc(f.client, owner, () => {}, () => true),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.counts().sends, 1);
});
test('metadata save failure prevents signing and sending', async () => {
  const f = fixture();
  f.storage.updateClaim = async () => { throw Error('disk failure'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /disk failure/);
  assert.equal(f.counts().sends, 0);
  assert.equal(f.getRecord().status, 'processing');
});
test('chain error during recovery keeps lock unknown', async () => {
  const f = fixture();
  f.client.sendUserOperation = async () => { throw Error('lost'); };
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true));
  f.client.getChainId = async () => { throw Error('offline'); };
  await assert.rejects(f.faucet.recoverJpycClaim(f.client, owner), /offline/);
  assert.equal(f.getRecord().status, 'unknown');
});
for (const field of ['sender', 'nonce', 'status']) test(`receipt ${field} mismatch never produces success`, async () => {
  const f = fixture();
  f.client.waitForUserOperationReceipt = async () => ({
    sender: field === 'sender' ? token : owner, nonce: field === 'nonce' ? 1n : 0n, success: true,
    receipt: { status: field === 'status' ? 'reverted' : 'success', transactionHash: hash, blockNumber: 1n, logs: [f.log] },
  });
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true));
  assert.notEqual(f.getRecord().status, 'success');
});
test('receipt-block decimals mismatch never marks success', async () => {
  const f = fixture();
  const read = f.publicClient.readContract;
  f.publicClient.readContract = async (args) => args.functionName === 'decimals' && f.counts().sends > 0 ? 6 : read(args);
  await assert.rejects(f.faucet.claimJpyc(f.client, owner, () => {}, () => true), /decimals/);
  assert.equal(f.getRecord().status, 'unknown');
});
test('recovery UI restores confirmed receipt without invoking claim', async () => {
  const service = { record: { status: 'unknown', operationHash: hash }, recover: async () => {
    service.record = { status: 'success', operationHash: hash, transactionHash: hash };
    return service.record;
  } };
  const p = await mountedPanel(service);
  const button = p.render().buttons.find((b) => b.props.children === '保存状態を確認・復旧（送信しません）');
  await button.props.onClick();
  assert.match(p.render().status, /正確な1 JPYCの受取を確認/);
  assert.equal(p.counts().claims, 0);
});
