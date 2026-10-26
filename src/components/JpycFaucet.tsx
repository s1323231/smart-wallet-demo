"use client";

import { useEffect, useRef, useState } from "react";
import { BaseError, type Address, type Hex } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { claimJpyc, JPYC_FAUCET_ADDRESS, prepareJpycClaim, recoverJpycClaim } from "@/lib/jpycFaucet";

import { JPYC_ADDRESS } from "@/lib/jpyc";
import { blocksClaim, claimKey, getClaimRecord, type ClaimRecord } from "@/lib/jpycClaimStore";

const documents = [
  ["利用規約", "https://jpyc.co.jp/legal/terms.pdf"],
  ["契約締結前交付書面兼説明書", "https://jpyc.co.jp/legal/pre-contract-disclosure.pdf"],
  ["プライバシーポリシー", "https://jpyc.co.jp/legal/privacy.pdf"],
];

export function JpycFaucet({ address, onReceived }: { address: Address; onReceived: () => Promise<void> }) {
  const { smartAccountClient } = useWallet();
  const [agreed, setAgreed] = useState<boolean[]>([false, false, false]);
  const agreedRef = useRef<boolean[]>([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sponsor, setSponsor] = useState<{ owner: Address; paymaster: Address } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmationOpen = useRef(false);
  const attempted = useRef(false);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [operationHash, setOperationHash] = useState<Hex | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hex | null>(null);
  const lock = useRef(false);
  // 送信後に応答を失っても、同じ画面から重ねて送らない。
  const submitted = useRef(false);
  const consent = agreed.every(Boolean);
  const [stored, setStored] = useState<ClaimRecord | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const persistedBlocked = !storageReady || blocksClaim(stored);
  const storageKey = claimKey(address, JPYC_FAUCET_ADDRESS, JPYC_ADDRESS);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const record = await getClaimRecord(storageKey);
        if (active) { setStored(record); setStorageReady(true); }
      } catch {
        if (active) { setStorageReady(false); setMessage("保存状態を確認できません。取得せず、保存領域を確認してください。"); }
      }
    };
    void refresh();
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("jpyc-claims") : null;
    if (channel) channel.onmessage = () => { void refresh(); };
    window.addEventListener("focus", refresh);
    return () => { active = false; channel?.close(); window.removeEventListener("focus", refresh); };
  }, [storageKey]);

  const recover = async () => {
    if (lock.current || !smartAccountClient) return;
    lock.current = true;
    setBusy(true);
    try {
      const record = await recoverJpycClaim(smartAccountClient, address);
      setStored(record);
      setStorageReady(true);
      if (record?.status === "success") {
        setTransactionHash(record.transactionHash ?? null);
        setMessage("取引と公式Faucetからの正確な1 JPYCの受取を確認しました。");
        await onReceived();
      } else if (record?.status === "failed") {
        attempted.current = false; submitted.current = false;
        setRetryBlocked(false); setOperationHash(null); setChecked(false);
        setMessage("送信前の中止、または取引失敗を確認済みです。再取得には事前確認と明示的な操作が必要です。");
      } else setMessage("保存済みの取得はありません。");
    } catch (error) {
      setMessage(`結果を確定できません。ロックを維持し、自動再送しません。${error instanceof Error ? error.message : "通信エラー"}`);
    } finally {
      try { setStored(await getClaimRecord(storageKey)); setStorageReady(true); }
      catch { setStorageReady(false); }
      lock.current = false; setBusy(false);
    }
  };


  const run = async (send: boolean) => {
    if (persistedBlocked || lock.current || attempted.current || submitted.current || !smartAccountClient) return;
    if (send && !agreedRef.current.every(Boolean)) {
      setMessage("取得には3つすべてへの同意が必要です。");
      return;
    }
    let submissionStarted = false;
    lock.current = true;
    setBusy(true);
    setMessage(send ? "取得前の再確認・スポンサー確認をしています…" : "Faucetの状態・シミュレーション・スポンサーを確認しています…");
    try {
      if (!send) {
        setSponsor(null);
        setChecked(false);
        const state = await prepareJpycClaim(smartAccountClient, address);
        setSponsor(state.paymaster ? { owner: address, paymaster: state.paymaster } : null);
        setChecked(true);
        setMessage(`事前確認が通りました。取得量: 1 JPYC、取得間隔: ${state.interval}秒、1回上限: ${state.amountLimit} JPYC、取得前残高上限: ${state.balanceLimit} JPYC、Faucet残高: ${state.faucetBalance} JPYC。取得成功はまだ未確認です。`);
      } else {
        setChecked(false);
        const hash = await claimJpyc(smartAccountClient, address, (hash) => {
          submitted.current = true;
          setOperationHash(hash);
          setMessage("送信済みです。取引の確定とJPYCの受取を確認しています…");
        }, () => agreedRef.current.every(Boolean), () => { submissionStarted = true; attempted.current = true; setRetryBlocked(true); });
        setTransactionHash(hash);
        setMessage("取引の成功と、このSmart Account宛てのJPYC受取を確認しました。");
        await onReceived();
      }
    } catch (error) {
      setChecked(false);
      setSponsor(null);
      const detail = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "通信エラー";
      setMessage(!send
        ? `事前確認に失敗しました。Faucetの条件・通信設定・Pimlicoのスポンサー設定を確認してください。${detail}`
        : submitted.current
        ? `送信後の結果を確認できませんでした。取得成功とは判断していません。再送せず、取引を確認してください。${detail}`
        : submissionStarted
        ? `署名・送信中にエラーが発生しました。送信された可能性があるため、再取得前に取引を確認してください。取得成功とは判断していません。${detail}`
        : `取得処理は送信前に失敗しました。Faucetの条件・通信設定・Pimlicoのスポンサー設定を確認してください。${detail}`);
    } finally {
      try { setStored(await getClaimRecord(storageKey)); setStorageReady(true); }
      catch { setStorageReady(false); }
      lock.current = false;
      setBusy(false);
    }
  };

  const closeConfirmation = () => {
    confirmationOpen.current = false;
    setConfirming(false);
  };

  const openConfirmation = () => {
    if (persistedBlocked || lock.current || attempted.current || !smartAccountClient || !checked || !agreedRef.current.every(Boolean)) return;
    confirmationOpen.current = true;
    setConfirming(true);
  };

  const confirmClaim = () => {
    if (!confirmationOpen.current || lock.current || attempted.current) return;
    closeConfirmation();
    return run(true);
  };

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-sm text-ink">公式Faucetから、現在のSmart Account自身に1 JPYCを取得します。ガス代スポンサーを確認できた場合だけ送信します。</p>
      <a href="https://faucet.jpyc.co.jp/" target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">公式JPYC Faucet</a>
      {documents.map(([label, url], index) => (
        <label key={url} className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={agreed[index]} disabled={busy || !!operationHash} onChange={(event) => {
            const values = agreedRef.current.map((value, i) => i === index ? event.target.checked : value);
            agreedRef.current = values;
            setAgreed(values);
          }} />
          <span><a href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{label}</a>を確認し、同意します</span>
        </label>
      ))}
      <button type="button" disabled={persistedBlocked || !smartAccountClient || busy || retryBlocked || confirming || !!operationHash} onClick={() => run(false)} className="text-sm text-accent underline disabled:opacity-50">取得条件・スポンサーを事前確認</button>
      <button type="button" disabled={persistedBlocked || !consent || !checked || busy || retryBlocked || confirming || !!operationHash} onClick={openConfirmation} className="w-full py-3 bg-accent hover:bg-accent-hover text-accent-ink rounded-2xl disabled:opacity-50">{busy ? "確認中…" : "テスト用JPYCを取得"}</button>
      {confirming && (
        <section role="dialog" aria-labelledby="jpyc-confirm-title" className="space-y-3 rounded-lg border border-line p-4">
          <h3 id="jpyc-confirm-title" className="font-semibold text-ink">JPYC取得の最終確認</h3>
          <dl className="space-y-2 text-sm text-ink break-all">
            <div><dt>ネットワーク</dt><dd>Ethereum Sepolia</dd></div>
            <div><dt>受取先（Smart Account）</dt><dd>{address}</dd></div>
            <div><dt>取得量</dt><dd>1 JPYC</dd></div>
            <div><dt>送信先（公式Faucet）</dt><dd>{JPYC_FAUCET_ADDRESS}</dd></div>
            <div><dt>呼び出す処理</dt><dd>sendToken</dd></div>
            <div><dt>ETH送付額</dt><dd>0 ETH</dd></div>
            <div><dt>ガス代スポンサー</dt><dd>{sponsor && sponsor.owner.toLowerCase() === address.toLowerCase()
              ? `事前確認でスポンサー応答・ガス見積もり成功（Paymaster: ${sponsor.paymaster}）`
              : "未確認"}</dd></div>
          </dl>
          <p className="text-sm text-muted">実行直前に条件・スポンサー・同意を再検証します。事前確認は取引の成功を保証しません。</p>
          <button type="button" disabled={!consent || busy || retryBlocked} onClick={confirmClaim} className="w-full py-3 bg-accent hover:bg-accent-hover text-accent-ink rounded-2xl disabled:opacity-50">この内容で取得する</button>
          <button type="button" disabled={busy} onClick={closeConfirmation} className="text-sm text-accent underline disabled:opacity-50">キャンセル</button>
        </section>
      )}
      <p className="text-xs text-muted">保存状態：{!storageReady ? "未確認（取得不可）" : stored ? ({ processing: "処理中", unknown: "結果不明", success: "成功確認済み", failed: "失敗確認済み（送信前中止を含む）" })[stored.status] : "取得記録なし"}</p>
      {stored && <p className="text-xs break-all text-muted">開始日時: {stored.startedAt} / nonce: {stored.nonce ?? "未取得"} / 開始ブロック: {stored.blockNumber ?? "未取得"}</p>}
      {stored?.operationHash && <p className="text-xs break-all text-muted">保存済みUserOperation: {stored.operationHash}</p>}
      <button type="button" disabled={busy || !smartAccountClient} onClick={recover} className="text-sm text-accent underline disabled:opacity-50">保存状態を確認・復旧（送信しません）</button>
      <p className="text-xs text-muted">チェーンIDの一致はスポンサーによる支払い保証ではありません。保存データの削除・別ブラウザや別端末では二重送信防止を共有できません。結果不明時は再送しないでください。</p>
      <p role="status" className="text-sm text-ink break-all">{message}</p>
      {operationHash && <p className="text-xs break-all text-muted">UserOperation: {operationHash}（確定した取引ハッシュとは異なります）</p>}
      {transactionHash && <a href={`https://sepolia.etherscan.io/tx/${transactionHash}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-accent underline break-all">受取済み取引: {transactionHash}</a>}
      {transactionHash && <p className="text-xs text-muted">履歴に保存する場合は、この取引ハッシュを下の受取確認欄に入力してください。</p>}
    </div>
  );
}
