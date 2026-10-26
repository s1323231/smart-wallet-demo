import type { Address, Hex } from "viem";

export type ClaimStatus = "processing" | "unknown" | "success" | "failed";
export type ClaimRecord = {
  key: string;
  attemptId: string;
  owner: Address;
  faucet: Address;
  token: Address;
  chainId: 11155111;
  status: ClaimStatus;
  startedAt: string;
  amount: string;
  decimals: 18;
  nonce?: string;
  blockNumber?: string;
  operationHash?: Hex;
  transactionHash?: Hex;
};
export const blocksClaim = (record: ClaimRecord | null) => record?.status === "processing" || record?.status === "unknown";
export const claimKey = (owner: Address, faucet: Address, token: Address) =>
  `11155111:${owner.toLowerCase()}:${faucet.toLowerCase()}:${token.toLowerCase()}`;

function validate(value: unknown, key: string): ClaimRecord | null {
  if (value === undefined) return null;
  const r = value as ClaimRecord;
  if (!r || r.key !== key || r.chainId !== 11155111 || r.decimals !== 18 || r.amount !== "1000000000000000000" ||
    typeof r.attemptId !== "string" || !r.attemptId || !["processing", "unknown", "success", "failed"].includes(r.status) ||
    ![r.owner, r.faucet, r.token].every((a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)) ||
    claimKey(r.owner, r.faucet, r.token) !== key || !Number.isFinite(Date.parse(r.startedAt)) ||
    [r.nonce, r.blockNumber].some((v) => v !== undefined && (typeof v !== "string" || !/^\d+$/.test(v))) ||
    [r.operationHash, r.transactionHash].some((h) => h !== undefined && (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)))) {
    throw new Error("取得状態の保存データを検証できません。再送せず状態を確認してください。");
  }
  return r;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("jpyc-faucet-claims", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("claims", { keyPath: "key" });
    request.onerror = () => reject(new Error("IndexedDBを利用できないため取得を中止します。"));
    request.onblocked = () => reject(new Error("取得状態の保存領域がブロックされています。"));
    request.onsuccess = () => resolve(request.result);
  });
}

// readwriteトランザクション内で照会と更新を完了し、別タブ間の競合を防ぐ。
async function transact(key: string, mutate?: (record: ClaimRecord | null) => ClaimRecord): Promise<ClaimRecord | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("claims", mutate ? "readwrite" : "readonly");
      const store = tx.objectStore("claims");
      const request = store.get(key);
      let result: ClaimRecord | null = null;
      let error: unknown;
      request.onsuccess = () => {
        try {
          result = validate(request.result, key);
          if (mutate) { result = mutate(result); validate(result, key); store.put(result); }
        } catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => {
        try {
          if (mutate && typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel("jpyc-claims");
            channel.postMessage(key); channel.close();
          }
        } catch { /* 通知に失敗しても取得直前のIndexedDB照合で排他する */ }
        resolve(result);
      };
      tx.onabort = tx.onerror = () => reject(error ?? new Error("取得状態を保存できません。再送せず確認してください。"));
    });
  } finally { db.close(); }
}

export const getClaimRecord = (key: string) => transact(key);
export async function reserveClaim(record: ClaimRecord) {
  await transact(record.key, (current) => {
    if (blocksClaim(current)) throw new Error("処理中または結果不明の取得があります。再送せず、保存状態を確認・復旧してください。");
    return record;
  });
}
export async function updateClaim(record: ClaimRecord, changes: Partial<Pick<ClaimRecord, "status" | "nonce" | "blockNumber" | "operationHash" | "transactionHash">>) {
  return transact(record.key, (current) => {
    if (!current || current.attemptId !== record.attemptId) throw new Error("保存状態が変更されました。再送せず確認してください。");
    // 遅延した通信エラーで、別タブが確認した確定結果を巻き戻さない。
    if (current.status === "success" || current.status === "failed") return current;
    return { ...current, ...changes };
  });
}
