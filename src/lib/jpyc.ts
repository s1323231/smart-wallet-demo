import { decodeEventLog, formatUnits, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { publicClient } from "./smartAccount";
import { getErc20Balance } from "./erc20";

// JPYC公式「開発者ドキュメント」のEthereum Sepolia掲載アドレス。
// https://faq.jpyc.co.jp/s/article/developer-documentation
export const JPYC_ADDRESS: Address = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";
const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export type JpycReceipt = {
  hash: Hex;
  amount: string;
  senders: string[];
  receivedAt: string;
};

export async function getJpycBalance(address: Address) {
  const { balance, decimals } = await getErc20Balance(JPYC_ADDRESS, address);
  return formatUnits(balance, decimals);
}

// 取引の宛先ではなくTransferログを調べることで、コントラクト経由の入金にも対応する。
export function readJpycTransfers(receipt: TransactionReceipt, owner: Address) {
  if (receipt.status !== "success") throw new Error("この取引は失敗しています。");
  let amount = BigInt(0);
  const senders = new Set<string>();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== JPYC_ADDRESS.toLowerCase()) continue;
    try {
      const { args } = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
      if (args.to.toLowerCase() === owner.toLowerCase() && args.value > BigInt(0)) {
        amount += args.value;
        senders.add(args.from);
      }
    } catch {
      // Transfer以外のログは対象外。
    }
  }
  if (amount === BigInt(0)) throw new Error("この取引には、あなた宛ての対象JPYCの受取記録がありません。");
  return { amount, senders: [...senders] };
}

export async function verifyJpycReceipt(hash: Hex, owner: Address): Promise<JpycReceipt> {
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const { amount, senders } = readJpycTransfers(receipt, owner);
  const [{ decimals }, block] = await Promise.all([
    getErc20Balance(JPYC_ADDRESS, owner),
    publicClient.getBlock({ blockHash: receipt.blockHash }),
  ]);
  return {
    hash: receipt.transactionHash.toLowerCase() as Hex,
    amount: formatUnits(amount, decimals),
    senders,
    receivedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}

export function loadJpycHistory(key: string): JpycReceipt[] {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(value) || !value.every((entry) =>
    entry && typeof entry === "object" &&
    typeof entry.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(entry.hash) &&
    typeof entry.amount === "string" && /^\d+(\.\d+)?$/.test(entry.amount) &&
    Array.isArray(entry.senders) && entry.senders.every((sender: unknown) => typeof sender === "string" && /^0x[0-9a-fA-F]{40}$/.test(sender)) &&
    typeof entry.receivedAt === "string" && Number.isFinite(Date.parse(entry.receivedAt))
  )) throw new Error("保存された履歴を読み込めません。");
  return value;
}
