"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Address, Hex } from "viem";
import { JpycFaucet } from "./JpycFaucet";
import { getJpycBalance, JPYC_ADDRESS, loadJpycHistory, verifyJpycReceipt, type JpycReceipt } from "@/lib/jpyc";

export function JpycPanel({ address }: { address: Address }) {
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<JpycReceipt[]>([]);
  const [ready, setReady] = useState(false);
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  const storageKey = `inapp-wallet-jpyc:11155111:${JPYC_ADDRESS.toLowerCase()}:${address.toLowerCase()}`;

  useEffect(() => {
    let active = true;
    getJpycBalance(address).then(
      (value) => { if (active) setBalance(value); },
      () => { if (active) setBalanceError(true); }
    );
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザの保存済み履歴を復元する。
      setHistory(loadJpycHistory(storageKey));
      setReady(true);
    } catch {
      setMessage("保存済み履歴を読み込めません。ブラウザの保存設定をご確認ください。");
    }
    return () => { active = false; };
  }, [address, storageKey]);

  const refreshBalance = async () => {
    setRefreshing(true);
    setBalanceError(false);
    try { setBalance(await getJpycBalance(address)); }
    catch { setBalanceError(true); }
    finally { setRefreshing(false); }
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || submitting.current) return;
    const txHash = hash.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
      setMessage("取引ハッシュは0xで始まる64桁の英数字（0〜9・a〜f）を入力してください。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    try {
      // 他のタブで追加された履歴も読み直す。
      const saved = loadJpycHistory(storageKey);
      if (saved.some((entry) => entry.hash.toLowerCase() === txHash)) {
        setHistory(saved);
        setMessage("この取引はすでに登録されています。");
        return;
      }
      let verified: JpycReceipt;
      try { verified = await verifyJpycReceipt(txHash as Hex, address); }
      catch (error) {
        setMessage(error instanceof Error && (error.message.startsWith("この取引") || error.message.startsWith("この取引には"))
          ? error.message
          : "取引を確認できませんでした。Sepoliaの確定済み取引ハッシュと通信設定を確認し、再度お試しください。");
        return;
      }
      const latest = loadJpycHistory(storageKey);
      if (latest.some((entry) => entry.hash.toLowerCase() === txHash)) {
        setHistory(latest);
        setMessage("この取引はすでに登録されています。");
        return;
      }
      const next = [verified, ...latest];
      localStorage.setItem(storageKey, JSON.stringify(next));
      setHistory(next);
      setHash("");
      setMessage("JPYCの受取を確認し、履歴に保存しました。");
      await refreshBalance();
    } catch {
      setMessage("履歴を保存・読み込みできませんでした。ブラウザの保存設定や空き容量をご確認ください。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface rounded-3xl border border-line shadow-soft p-6 space-y-4">
      <h2 className="ribbon-heading font-semibold text-ink">テスト用JPYC（Sepolia）</h2>
      <div>
        <p className="text-sm text-muted">自分のSmart Account（受取先）</p>
        <p className="font-mono text-xs text-ink break-all">{address}</p>
      </div>
      <div>
        <p className="text-sm text-muted">JPYC残高</p>
        <p className="text-3xl font-bold text-ink">{balance ?? "—"} <span className="text-lg font-normal">JPYC</span></p>
        <button type="button" onClick={refreshBalance} disabled={refreshing || busy} className="text-sm text-accent hover:underline disabled:opacity-50">
          {refreshing ? "更新中..." : "残高を更新"}
        </button>
        {balanceError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">残高を取得できませんでした。通信設定を確認して更新してください。</p>}
      </div>
      <a href={`https://sepolia.etherscan.io/token/${JPYC_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent hover:underline">対象JPYCコントラクトを確認 ↗</a>
      <JpycFaucet address={address} onReceived={refreshBalance} />
      <form onSubmit={handleVerify} className="space-y-3">
        <label htmlFor="jpyc-tx-hash" className="block text-sm text-muted">受け取った取引のハッシュ</label>
        <input id="jpyc-tx-hash" required value={hash} onChange={(event) => setHash(event.target.value)} placeholder="0x..." className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-ink font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
        <button disabled={!ready || busy || !hash.trim()} className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink text-accent-ink rounded-2xl font-medium transition-colors">{busy ? "確認中..." : "JPYCの受取を確認"}</button>
      </form>
      <p role="status" className="text-sm text-ink">{message}</p>
      <div>
        <h3 className="text-sm font-medium text-ink">確認済みの受取履歴（{history.length}件）</h3>
        {ready && history.length === 0 && <p className="mt-2 text-sm text-muted">確認済みの受取はありません。</p>}
        <ul className="divide-y divide-line">
          {history.map((entry) => (
            <li key={entry.hash} className="py-3 space-y-1 text-sm">
              <p className="font-semibold text-ink">{entry.amount} JPYC</p>
              <time dateTime={entry.receivedAt} className="block text-muted">{new Date(entry.receivedAt).toLocaleString("ja-JP")}</time>
              {entry.senders.map((sender) => <p key={sender} className="text-xs text-muted break-all">送付元：{sender}</p>)}
              <a href={`https://sepolia.etherscan.io/tx/${entry.hash}`} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent hover:underline break-all">{entry.hash} ↗</a>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">確認した取引だけを表示します。履歴はこのブラウザに保存され、データを消すと失われます。</p>
    </section>
  );
}
