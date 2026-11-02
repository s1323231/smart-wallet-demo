import { isAddress, isHex, type Address, type Hex } from "viem";

export type RegistrationAttempt = {
  event: Address;
  owner: Address;
  attemptId: string;
  startedAt: string;
  status: "processing" | "unknown" | "success" | "failed";
  nonce?: string;
  operationHash?: Hex;
  transactionHash?: Hex;
};
export const blocksRegistration = (r: RegistrationAttempt | null) => r !== null && r.status !== "failed";

function validate(value: unknown, event: Address, owner: Address): RegistrationAttempt | null {
  if (value === undefined) return null;
  const r = value as RegistrationAttempt;
  if (!r || !isAddress(r.event) || !isAddress(r.owner) || r.event.toLowerCase() !== event.toLowerCase() ||
    r.owner.toLowerCase() !== owner.toLowerCase() || typeof r.attemptId !== "string" || !r.attemptId ||
    !Number.isFinite(Date.parse(r.startedAt)) || !["processing", "unknown", "success", "failed"].includes(r.status) ||
    (r.nonce !== undefined && (typeof r.nonce !== "string" || !/^\d+$/.test(r.nonce))) ||
    [r.operationHash, r.transactionHash].some((h) => h !== undefined && (!isHex(h, { strict: true }) || h.length !== 66))) {
    throw new Error("参加登録の保存記録を読み取れません。削除や再送をせず、主催者にお問い合わせください。");
  }
  return r;
}

async function transact(event: Address, owner: Address, mutate?: (current: RegistrationAttempt | null) => RegistrationAttempt) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("event-registrations-sepolia", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("attempts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error("参加登録の保存領域を開けません。送信を中止します。"));
  });
  try {
    return await new Promise<RegistrationAttempt | null>((resolve, reject) => {
      const tx = db.transaction("attempts", mutate ? "readwrite" : "readonly");
      const store = tx.objectStore("attempts");
      const key = `11155111:${event.toLowerCase()}:${owner.toLowerCase()}`;
      const request = store.get(key);
      let result: RegistrationAttempt | null = null;
      let error: unknown;
      request.onsuccess = () => {
        try {
          result = validate(request.result, event, owner);
          if (mutate) { result = mutate(result); validate(result, event, owner); store.put(result, key); }
        } catch (cause) { error = cause; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(error ?? new Error("参加登録の記録を保存できません。再送せず受取状況を確認してください。"));
    });
  } finally { db.close(); }
}

export const getRegistrationAttempt = (event: Address, owner: Address) => transact(event, owner);
export const reserveRegistration = (record: RegistrationAttempt) => transact(record.event, record.owner, (current) => {
  if (blocksRegistration(current)) throw new Error("登録済み、または結果未確認の参加登録があります。「受取状況を確認」を押してください。");
  return record;
});
export const updateRegistrationAttempt = (record: RegistrationAttempt, changes: Partial<Pick<RegistrationAttempt, "status" | "nonce" | "operationHash" | "transactionHash">>) => transact(record.event, record.owner, (current) => {
  if (!current || current.attemptId !== record.attemptId) throw new Error("参加登録の記録が変更されました。再送せず受取状況を確認してください。");
  if (current.status === "success" || current.status === "failed") return current;
  return { ...current, ...changes };
});
