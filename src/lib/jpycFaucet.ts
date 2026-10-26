import { encodeFunctionData, formatUnits, parseAbi, parseUnits, zeroAddress, type Address, type TransactionReceipt } from "viem";
import { publicClient, type createSmartAccount } from "./smartAccount";
import { JPYC_ADDRESS } from "./jpyc";
import { ERC20_ABI } from "./erc20";
import { decodeEventLog } from "viem";
import { blocksClaim, claimKey, getClaimRecord, reserveClaim, updateClaim, type ClaimRecord } from "./jpycClaimStore";

// 公式Faucet配信コードのSepolia設定とEtherscanの検証済みABIを照合。
// https://faucet.jpyc.co.jp/
// https://sepolia.etherscan.io/address/0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5#code
export const JPYC_FAUCET_ADDRESS: Address = "0x5Fe7943a7823f6837756e9F0f259cd93494cc5D5";
export const FAUCET_ABI = parseAbi([
  "function token() view returns (address)",
  "function paused() view returns (bool)",
  "function whitelistEnabled() view returns (bool)",
  "function isWhitelisted(address) view returns (bool)",
  "function getLimits() view returns (uint256 timeLimit, uint256 amountLimit, uint256 balanceLimit)",
  "function getFaucetBalance() view returns (uint256)",
  "function lastAccessTime(address) view returns (uint256)",
  "function sendToken(address _to, uint256 _amount)",
]);
type SmartClient = Awaited<ReturnType<typeof createSmartAccount>>;

// 読み取り・eth_call・ガス見積もりのみ。署名や送信はしない。
export async function prepareJpycClaim(client: SmartClient, owner: Address, activeAttempt?: string) {
  if (client.chain?.id !== 11155111 || client.account.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Sepoliaの接続中Smart Accountを確認してください。");
  }
  await assertJpycChains(client);
  const pending = await getClaimRecord(claimKey(owner, JPYC_FAUCET_ADDRESS, JPYC_ADDRESS));
  if (blocksClaim(pending) && pending?.attemptId !== activeAttempt) throw new Error("未解決の取得があります。再送せず保存状態を確認・復旧してください。");
  const block = await publicClient.getBlock();
  const read = <N extends "token" | "paused" | "whitelistEnabled" | "getLimits" | "getFaucetBalance">(functionName: N) =>
    publicClient.readContract({ address: JPYC_FAUCET_ADDRESS, abi: FAUCET_ABI, functionName, blockNumber: block.number });
  const [token, paused, whitelistEnabled, limits, faucetBalance, whitelisted, lastAccess, balance, decimals] = await Promise.all([
    read("token"), read("paused"), read("whitelistEnabled"), read("getLimits"), read("getFaucetBalance"),
    publicClient.readContract({ address: JPYC_FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "isWhitelisted", args: [owner], blockNumber: block.number }),
    publicClient.readContract({ address: JPYC_FAUCET_ADDRESS, abi: FAUCET_ABI, functionName: "lastAccessTime", args: [owner], blockNumber: block.number }),
    publicClient.readContract({ address: JPYC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [owner], blockNumber: block.number }),
    publicClient.readContract({ address: JPYC_ADDRESS, abi: ERC20_ABI, functionName: "decimals", blockNumber: block.number }),
  ]);
  if (token.toLowerCase() !== JPYC_ADDRESS.toLowerCase()) throw new Error("Faucetの配布トークンが設定と異なるため取得を中止しました。");
  if (paused) throw new Error("公式Faucetは一時停止中です。");
  if (whitelistEnabled && !whitelisted) throw new Error("このSmart AccountはFaucetの許可リストに登録されていません。");
  const [interval, amountLimit, balanceLimit] = limits;
  if (lastAccess !== BigInt(0) && block.timestamp < lastAccess + interval) {
    throw new Error(`次回取得可能日時: ${new Date(Number(lastAccess + interval) * 1000).toLocaleString("ja-JP")}`);
  }
  if (balance > balanceLimit) throw new Error("JPYC残高がFaucetの取得前残高上限を超えています。");
  // 少額の動作確認用。上限はコントラクトから毎回取得し、固定値を信用しない。
  if (decimals !== 18) throw new Error("JPYCのdecimalsが18と一致しないため中止しました。");
  const amount = parseUnits("1", decimals);
  if (amount > amountLimit) throw new Error("Faucetの取得上限が1 JPYC未満です。");
  if (faucetBalance < amount) throw new Error("公式FaucetのJPYC残高が不足しています。");
  await publicClient.simulateContract({
    account: owner, address: JPYC_FAUCET_ADDRESS, abi: FAUCET_ABI,
    functionName: "sendToken", args: [owner, amount], blockNumber: block.number,
  });
  const calls = [{ to: JPYC_FAUCET_ADDRESS, value: BigInt(0), data: encodeFunctionData({ abi: FAUCET_ABI, functionName: "sendToken", args: [owner, amount] }) }];
  // 未デプロイのSmart Accountも含め、EntryPoint経由の操作を見積もる。
  const operation = await client.prepareUserOperation({ calls });
  if (!operation.paymaster || operation.paymaster === zeroAddress) {
    throw new Error("Pimlicoのガス代スポンサーを確認できないため、送信しません。");
  }
  await client.estimateUserOperationGas({ ...operation });
  return { operation, blockNumber: block.number.toString(), paymaster: operation.paymaster, amount: "1", faucetBalance: formatUnits(faucetBalance, decimals), interval: interval.toString(), amountLimit: formatUnits(amountLimit, decimals), balanceLimit: formatUnits(balanceLimit, decimals) };
}

export async function assertJpycChains(client: SmartClient) {
  const [rpcChain, bundlerChain] = await Promise.all([
    publicClient.getChainId(), client.getChainId(),
  ]);
  if (rpcChain !== 11155111 || bundlerChain !== 11155111) {
    throw new Error("公開RPCとBundlerの実チェーンIDがSepolia（11155111）と一致しません。");
  }
}

const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
export function verifyFaucetTransfer(receipt: TransactionReceipt, owner: Address, decimals: number) {
  if (decimals !== 18) throw new Error("JPYCのdecimalsが18と一致しません。");
  if (receipt.status !== "success") throw new Error("この取引は失敗しています。");
  let total = BigInt(0);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== JPYC_ADDRESS.toLowerCase()) continue;
    try {
      const { args } = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (args.from.toLowerCase() === JPYC_FAUCET_ADDRESS.toLowerCase() && args.to.toLowerCase() === owner.toLowerCase()) total += args.value;
    } catch { /* Transfer以外のログは対象外 */ }
  }
  if (total !== parseUnits("1", 18)) throw new Error("公式Faucetから自分宛ての正確な1 JPYCの受取記録を確認できません。");
}

async function confirmResult(client: SmartClient, record: ClaimRecord, wait: boolean) {
  if (!record.operationHash) throw new Error("UserOperationハッシュ不明です。自動解除・再送はしません。管理者とチェーン上の結果を確認してください。");
  const result = wait
    ? await client.waitForUserOperationReceipt({ hash: record.operationHash, timeout: 120_000 })
    : await client.getUserOperationReceipt({ hash: record.operationHash });
  if (!result) throw new Error("結果未確定です。ロックを維持します。");
  if (result.sender.toLowerCase() !== record.owner.toLowerCase() || result.nonce.toString() !== record.nonce) throw new Error("取得結果のSmart Accountまたはnonceが一致しません。");
  if (!result.success || result.receipt.status !== "success") {
    await updateClaim(record, { status: "failed", transactionHash: result.receipt.transactionHash });
    throw new Error("取得処理の失敗を確認しました。成功表示は行いません。");
  }
  const decimals = await publicClient.readContract({ address: JPYC_ADDRESS, abi: ERC20_ABI, functionName: "decimals", blockNumber: result.receipt.blockNumber });
  verifyFaucetTransfer(result.receipt, record.owner, decimals);
  await updateClaim(record, { status: "success", transactionHash: result.receipt.transactionHash });
  return result.receipt.transactionHash;
}

export async function recoverJpycClaim(client: SmartClient, owner: Address) {
  const record = await getClaimRecord(claimKey(owner, JPYC_FAUCET_ADDRESS, JPYC_ADDRESS));
  if (!record || record.status === "failed") return record;
  try { await assertJpycChains(client); await confirmResult(client, record, false); }
  catch (error) {
    await updateClaim(record, { status: "unknown" });
    throw error;
  }
  return getClaimRecord(record.key);
}

export async function claimJpyc(client: SmartClient, owner: Address, onSubmitted: (hash: `0x${string}`) => void, hasConsent: () => boolean, onSubmissionStarted: () => void = () => {}) {
  if (!hasConsent()) throw new Error("取得には3つすべてへの同意が必要です。");
  const record: ClaimRecord = {
    key: claimKey(owner, JPYC_FAUCET_ADDRESS, JPYC_ADDRESS), attemptId: crypto.randomUUID(), owner,
    faucet: JPYC_FAUCET_ADDRESS, token: JPYC_ADDRESS, chainId: 11155111,
    status: "processing", startedAt: new Date().toISOString(), amount: "1000000000000000000", decimals: 18,
  };
  await reserveClaim(record);
  let started = false;
  try {
    const { operation, blockNumber } = await prepareJpycClaim(client, owner, record.attemptId);
    await updateClaim(record, { nonce: operation.nonce.toString(), blockNumber });
    await assertJpycChains(client);
    if (!hasConsent()) throw new Error("同意を確認できないため、署名・送信を中止しました。");
    started = true;
    onSubmissionStarted();
    const hash = await client.sendUserOperation({ ...operation, signature: undefined });
    onSubmitted(hash);
    await updateClaim(record, { operationHash: hash });
    return await confirmResult(client, { ...record, nonce: operation.nonce.toString(), operationHash: hash }, true);
  } catch (error) {
    // 送信開始後はハッシュがなくてもロック維持。送信前に中止できた場合だけ失敗確定。
    await updateClaim(record, { status: started ? "unknown" : "failed" });
    throw error;
  }
}
