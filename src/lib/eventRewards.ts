import { encodeFunctionData, isAddress, parseAbi, zeroAddress, type Address } from "viem";
import { publicClient, type createSmartAccount } from "./smartAccount";
import { JPYC_ADDRESS } from "./jpyc";

export const EVENT_ABI = parseAbi([
  "function jpyc() view returns (address)",
  "function reward() view returns (uint256)",
  "function certificateOf(address) view returns (uint256)",
  "function registeredAt(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function register()",
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
export async function registerForEvent(client: SmartClient, onSubmitted: (hash: string) => void) {
  if (!EVENT_ADDRESS) throw new Error("イベントは準備中です。");
  if (await client.getChainId() !== 11155111) throw new Error("接続先がSepoliaではありません。");
  const existing = await getRegistration(client.account.address);
  if (existing) return existing;
  const calls = [{ to: EVENT_ADDRESS, data: encodeFunctionData({ abi: EVENT_ABI, functionName: "register" }), value: BigInt(0) }];
  await publicClient.simulateContract({ address: EVENT_ADDRESS, abi: EVENT_ABI, functionName: "register", account: client.account.address });
  const operation = await client.prepareUserOperation({ calls });
  if (!operation.paymaster || operation.paymaster === zeroAddress) {
    throw new Error("手数料のスポンサーを確認できません。主催者にお問い合わせください。");
  }
  const hash = await client.sendUserOperation({ ...operation, signature: undefined });
  onSubmitted(hash);
  const receipt = await client.waitForUserOperationReceipt({ hash, timeout: 120_000 });
  if (!receipt.success || receipt.receipt.status !== "success") throw new Error("登録処理が失敗しました。受取状況を確認してください。");
  const registration = await getRegistration(client.account.address);
  if (!registration) throw new Error("受取結果をまだ確認できません。受取状況を確認してください。");
  return registration;
}
