import { decodeEventLog, encodeFunctionData, isAddress, parseAbi, zeroAddress, type Address, type TransactionReceipt } from "viem";
import { publicClient, type createSmartAccount } from "./smartAccount";
import { JPYC_ADDRESS } from "./jpyc";
import { getRegistrationAttempt, reserveRegistration, updateRegistrationAttempt, type RegistrationAttempt } from "./eventRegistrationStore";

export const EVENT_ABI = parseAbi([
  "function jpyc() view returns (address)",
  "function reward() view returns (uint256)",
  "function certificateOf(address) view returns (uint256)",
  "function registeredAt(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function register()",
  "event Registered(address indexed participant, uint256 indexed tokenId, uint256 amount)",
]);
const configured = process.env.NEXT_PUBLIC_EVENT_REWARDS_ADDRESS ?? "";
export const EVENT_ADDRESS = isAddress(configured) && configured !== zeroAddress ? configured as Address : null;
export type EventRegistration = { tokenId: string; registeredAt: string };

export async function getRegistration(owner: Address): Promise<EventRegistration | null> {
  if (!EVENT_ADDRESS) throw new Error("イベントは準備中です。");
  if (await publicClient.getChainId() !== 11155111) throw new Error("接続先がSepoliaではありません。");
  const [token, reward, id, timestamp] = await Promise.all([
    publicClient.readContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "jpyc" }),
    publicClient.readContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "reward" }),
    publicClient.readContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "certificateOf", args: [owner] }),
    publicClient.readContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "registeredAt", args: [owner] }),
  ]);
  if (token.toLowerCase() !== JPYC_ADDRESS.toLowerCase() || reward !== BigInt(10) ** BigInt(18)) {
    throw new Error("イベントの配布設定を確認してください。");
  }
  if (id === BigInt(0)) return null;
  return { tokenId: id.toString(), registeredAt: new Date(Number(timestamp) * 1000).toISOString() };
}

type SmartClient = Awaited<ReturnType<typeof createSmartAccount>>;
async function assertEventChains(client: SmartClient) {
  const [rpc, bundler] = await Promise.all([publicClient.getChainId(), client.getChainId()]);
  if (rpc !== 11155111 || bundler !== 11155111) throw new Error("公開RPCとBundlerの接続先がSepoliaではありません。");
}

const TOKEN_TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const NFT_TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
function verifyRewards(receipt: TransactionReceipt, owner: Address, registration: EventRegistration) {
  let amount = BigInt(0);
  let minted = false;
  let registered = false;
  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() === JPYC_ADDRESS.toLowerCase()) {
        const { args } = decodeEventLog({ abi: TOKEN_TRANSFER, data: log.data, topics: log.topics });
        if (args.from.toLowerCase() === EVENT_ADDRESS!.toLowerCase() && args.to.toLowerCase() === owner.toLowerCase()) amount += args.value;
      } else if (log.address.toLowerCase() === EVENT_ADDRESS!.toLowerCase()) {
        try {
          const { args } = decodeEventLog({ abi: NFT_TRANSFER, data: log.data, topics: log.topics });
          if (args.from === zeroAddress && args.to.toLowerCase() === owner.toLowerCase() && args.tokenId.toString() === registration.tokenId) minted = true;
        } catch {
          const { args } = decodeEventLog({ abi: EVENT_ABI, eventName: "Registered", data: log.data, topics: log.topics });
          if (args.participant.toLowerCase() === owner.toLowerCase() && args.tokenId.toString() === registration.tokenId && args.amount === BigInt(10) ** BigInt(18)) registered = true;
        }
      }
    } catch { /* Unrelated logs do not prove receipt of the rewards. */ }
  }
  if (amount !== BigInt(10) ** BigInt(18) || !minted || !registered) throw new Error("1 JPYCと参加証NFTの受取記録を確認できません。再送せず受取状況を確認してください。");
}

async function confirmRegistration(client: SmartClient, attempt: RegistrationAttempt, wait: boolean) {
  if (!attempt.operationHash) throw new Error("受付番号を取得できていません。再送せず主催者にお問い合わせください。");
  const receipt = wait
    ? await client.waitForUserOperationReceipt({ hash: attempt.operationHash, timeout: 120_000 })
    : await client.getUserOperationReceipt({ hash: attempt.operationHash });
  if (!receipt) throw new Error("参加登録の結果はまだ未確定です。少し待って受取状況を確認してください。");
  if (receipt.sender.toLowerCase() !== attempt.owner.toLowerCase() || BigInt(receipt.nonce).toString() !== attempt.nonce) throw new Error("取得結果のアカウントまたはnonceが一致しません。再送せず主催者にお問い合わせください。");
  if (!receipt.success || receipt.receipt.status !== "success") {
    await updateRegistrationAttempt(attempt, { status: "failed", transactionHash: receipt.receipt.transactionHash });
    throw new Error("参加登録の失敗を確認しました。受取状況を確認してから再登録できます。");
  }
  const registration = await getRegistration(attempt.owner);
  if (!registration) throw new Error("受取結果をまだ確認できません。再送せず受取状況を確認してください。");
  verifyRewards(receipt.receipt, attempt.owner, registration);
  await updateRegistrationAttempt(attempt, { status: "success", transactionHash: receipt.receipt.transactionHash });
  return registration;
}

export async function registerForEvent(client: SmartClient, onSubmitted: (hash: string) => void) {
  if (!EVENT_ADDRESS) throw new Error("イベントは準備中です。");
  await assertEventChains(client);
  const existing = await getRegistration(client.account.address);
  if (existing) return existing;
  const attempt: RegistrationAttempt = { event: EVENT_ADDRESS, owner: client.account.address, attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(), status: "processing" };
  await reserveRegistration(attempt);
  let started = false;
  try {
    const calls = [{ to: EVENT_ADDRESS, data: encodeFunctionData({ abi: EVENT_ABI, functionName: "register" }), value: BigInt(0) }];
    await publicClient.simulateContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "register", account: client.account.address });
    const operation = await client.prepareUserOperation({ calls });
    if (!operation.paymaster || operation.paymaster === zeroAddress) throw new Error("手数料のスポンサーを確認できません。主催者にお問い合わせください。");
    await client.estimateUserOperationGas({ ...operation });
    const nonce = operation.nonce.toString();
    await updateRegistrationAttempt(attempt, { nonce });
    await assertEventChains(client);
    started = true;
    const hash = await client.sendUserOperation({ ...operation, signature: undefined });
    onSubmitted(hash);
    await updateRegistrationAttempt(attempt, { operationHash: hash });
    return await confirmRegistration(client, { ...attempt, nonce, operationHash: hash }, true);
  } catch (error) {
    await updateRegistrationAttempt(attempt, { status: started ? "unknown" : "failed" });
    throw error;
  }
}

// No signatures or sends. The trusted contract registers, transfers JPYC and mints atomically.
export async function recoverEventRegistration(client: SmartClient) {
  if (!EVENT_ADDRESS) throw new Error("イベントは準備中です。");
  await assertEventChains(client);
  const owner = client.account.address;
  const attempt = await getRegistrationAttempt(EVENT_ADDRESS, owner);
  const registration = await getRegistration(owner);
  if (registration) {
    if (attempt) await updateRegistrationAttempt(attempt, { status: "success" });
    return registration;
  }
  if (!attempt || attempt.status === "failed") return null;
  if (attempt.status === "success") throw new Error("以前の参加記録を読み取れません。再送せず接続先を確認してください。");
  try { return await confirmRegistration(client, attempt, false); }
  catch (error) { await updateRegistrationAttempt(attempt, { status: "unknown" }); throw error; }
}
