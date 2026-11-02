import { isAddress, isHex, type Address, type Hex } from "viem";

export type DeploymentRecord = {
  owner: Address;
  address: Address;
  initCodeHash: Hex;
  attemptId: string;
  startedAt: string;
  status: "processing" | "unknown" | "success" | "failed";
  nonce?: string;
  operationHash?: Hex;
  transactionHash?: Hex;
};

function validate(value: unknown, owner: Address): DeploymentRecord | null {
  if (value === undefined) return null;
  const r = value as DeploymentRecord;
  if (!r || !isAddress(r.owner) || r.owner.toLowerCase() !== owner.toLowerCase() || !isAddress(r.address) ||
    !isHex(r.initCodeHash, { strict: true }) || r.initCodeHash.length !== 66 ||
    !["processing", "unknown", "success", "failed"].includes(r.status) ||
    typeof r.attemptId !== "string" || !r.attemptId || !Number.isFinite(Date.parse(r.startedAt)) ||
    (r.nonce !== undefined && (typeof r.nonce !== "string" || !/^\d+$/.test(r.nonce))) ||
    [r.operationHash, r.transactionHash].some((h) => h !== undefined && (!isHex(h, { strict: true }) || h.length !== 66))) {
    throw new Error("設置の保存記録を読み取れません。削除・再送せず確認してください。");
  }
  return r;
}

// Separate from Faucet storage. A readwrite transaction reserves across tabs.
async function transact(owner: Address, mutate?: (record: DeploymentRecord | null) => DeploymentRecord) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("event-deployments-sepolia", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("deployments");
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error("設置記録の保存領域を開けません。送信を中止します。"));
  });
  try {
    return await new Promise<DeploymentRecord | null>((resolve, reject) => {
      const tx = db.transaction("deployments", mutate ? "readwrite" : "readonly");
      const store = tx.objectStore("deployments");
      const key = owner.toLowerCase();
      const request = store.get(key);
      let result: DeploymentRecord | null = null;
      let error: unknown;
      const consume = (value: unknown) => {
        try {
          result = validate(value, owner);
          if (mutate) {
            result = mutate(result);
            validate(result, owner);
            store.put(result, key);
          }
        } catch (cause) { error = cause; tx.abort(); }
      };
      request.onsuccess = () => consume(request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(error ?? new Error("設置記録を保存できません。再送せず確認してください。"));
    });
  } finally { db.close(); }
}

export const getDeploymentRecord = (owner: Address) => transact(owner);
export async function reserveDeployment(record: DeploymentRecord) {
  return transact(record.owner, (current) => {
    if (current && current.status !== "failed") throw new Error("設置済み、または未解決の設置記録があります。「設置状況を確認」を使ってください。");
    return record;
  });
}
export async function updateDeployment(record: DeploymentRecord, changes: Partial<Pick<DeploymentRecord, "status" | "nonce" | "operationHash" | "transactionHash">>) {
  return transact(record.owner, (current) => {
    if (!current || current.attemptId !== record.attemptId) throw new Error("設置記録が変更されました。再送せず確認してください。");
    if (current.status === "success" || current.status === "failed") return current;
    return { ...current, ...changes };
  });
}
