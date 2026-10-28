"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { EVENT_ADDRESS, getRegistration, registerForEvent, type EventRegistration } from "@/lib/eventRewards";
import { getJpycBalance } from "@/lib/jpyc";
import type { Address } from "viem";

export function EventCheckIn({ address }: { address: Address }) {
  const { smartAccountClient } = useWallet();
  const [registration, setRegistration] = useState<EventRegistration | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [operationHash, setOperationHash] = useState<string | null>(null);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    const result = await getRegistration(address);
    setRegistration(result);
    setReady(true);
    // A balance RPC failure must not erase a confirmed registration.
    try { setBalance(await getJpycBalance(address)); } catch { setBalance(null); }
    return result;
  }, [address]);

  useEffect(() => {
    let active = true;
    if (!EVENT_ADDRESS) return;
    const load = async () => {
      try {
        const result = await getRegistration(address);
        if (!active) return;
        setRegistration(result); setReady(true);
        try { const amount = await getJpycBalance(address); if (active) setBalance(amount); } catch { /* Retry with the status button. */ }
      } catch { if (active) setMessage("受取状況を読み込めませんでした。もう一度確認してください。"); }
    };
    void load();
    return () => { active = false; };
  }, [address]);

  const check = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await refresh();
      setMessage(result ? "参加ポイントと参加証の配布を確認しました。" : submitted ? "まだ登録を確認できません。少し待ってから再確認してください。" : "参加登録できます。");
    } catch { setMessage("受取状況を確認できません。時間をおいて再確認してください。"); }
    finally { lock.current = false; setBusy(false); }
  };

  const register = async () => {
    if (lock.current || !ready || registration || submitted || !smartAccountClient) return;
    lock.current = true; setBusy(true); setMessage("参加特典を準備しています。そのままお待ちください。");
    try {
      // Block resubmission after an ambiguous signing/network error. The contract also enforces one claim per wallet.
      setSubmitted(true);
      const result = await registerForEvent(smartAccountClient, (hash) => setOperationHash(hash));
      setRegistration(result);
      setMessage("参加登録が完了しました！");
      try { setBalance(await getJpycBalance(address)); } catch { setBalance(null); }
    } catch {
      setMessage("登録の完了を確認できませんでした。「受取状況を確認」を押してください。未受取のままの場合は主催者にお問い合わせください。");
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-soft space-y-5">
        <div><p className="text-xs font-semibold tracking-widest text-accent">LIVE EVENT</p><h2 className="mt-2 text-xl font-semibold">LIVE・イベント参加記録</h2><p className="mt-2 text-sm text-muted">今日の思い出に、参加ポイントとデジタル参加証を。</p></div>
        <div className="rounded-2xl bg-soft p-4 text-sm"><p className="font-semibold">参加特典：1ポイント ＋ 参加証NFT</p><p className="mt-1 text-muted">1ポイント＝テスト用の1 JPYC。参加費・手数料はかかりません。</p></div>
        {!EVENT_ADDRESS ? <p role="status" className="text-sm text-muted">ただいま主催者がイベントを準備しています。配布開始までお待ちください。</p> : <>
          <p className="text-xs text-muted">登録すると、このアカウントに特典をお届けします。受取は1アカウントにつき1回です。</p>
          <button onClick={register} disabled={!ready || busy || !!registration || submitted || !smartAccountClient} className="w-full rounded-2xl bg-accent py-4 font-semibold text-accent-ink hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink">{registration ? "参加登録済み ✓" : busy ? "確認しています…" : submitted ? "受取状況を確認してください" : "参加登録して特典を受け取る"}</button>
          <button onClick={check} disabled={busy} className="w-full text-sm text-accent underline disabled:opacity-50">受取状況を確認</button>
        </>}
        <p role="status" className="text-sm text-muted">{message}</p>
      </section>
      <section className="rounded-3xl border border-line bg-surface p-6 shadow-soft space-y-4">
        <h2 className="font-semibold">受け取った特典</h2>
        {registration ? <>
          <div className="rounded-2xl bg-soft p-4"><p className="text-sm text-muted">参加ポイント受取済み</p><p className="text-3xl font-semibold text-accent">1 <span className="text-sm">ポイント</span></p><p className="mt-1 text-xs text-muted">現在のJPYC残高：{balance ?? "確認できませんでした"}{balance !== null ? " JPYC" : ""}</p></div>
          <div className="rounded-2xl border border-line p-6 text-center space-y-2"><p className="text-xs tracking-widest text-accent">PARTICIPATION CERTIFICATE</p><p className="text-xl font-semibold">LIVE・イベント参加記録</p><p className="text-sm text-muted">ご参加ありがとうございます</p><p className="text-xs text-muted">登録日：{new Date(registration.registeredAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} ／ No. {registration.tokenId}</p><a href={`https://sepolia.etherscan.io/token/${EVENT_ADDRESS}?a=${registration.tokenId}`} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-accent underline">参加証NFTの発行記録を見る</a></div>
        </> : <p className="text-sm text-muted">参加登録すると、ここに特典が表示されます。</p>}
      </section>
      {operationHash && <details className="text-xs text-muted"><summary>処理の確認情報</summary><p className="mt-2 break-all">受付番号（UserOperation）：{operationHash}</p></details>}
      <p className="px-2 text-center text-xs text-muted">Sepoliaテストネットを使った研究用アプリです。<br />ポイントは実際のお金や商品には交換できません。</p>
    </div>
  );
}
