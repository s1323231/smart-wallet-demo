"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BaseError, type Address } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { EVENT_ADDRESS, recoverEventRegistration, registerForEvent, type EventRegistration } from "@/lib/eventRewards";
import { blocksRegistration, getRegistrationAttempt, type RegistrationAttempt } from "@/lib/eventRegistrationStore";

type Step = "input" | "confirm" | "complete";
const steps: Step[] = ["input", "confirm", "complete"];
const labels = ["入力", "確認", "完了"];
const primary = "w-full rounded-2xl bg-accent px-4 py-3 font-semibold text-accent-ink hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink";

export function EventRegistrationForm({ address, onRegistered }: { address: Address; onRegistered: () => void }) {
  const { smartAccountClient } = useWallet();
  const [step, setStep] = useState<Step>("input");
  const [nickname, setNickname] = useState("");
  const eventName = "LIVE・イベント参加記録";
  const [registration, setRegistration] = useState<EventRegistration | null>(null);
  const [attempt, setAttempt] = useState<RegistrationAttempt | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [operationHash, setOperationHash] = useState<string | null>(null);
  const lock = useRef(false);
  const notified = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>("input");
  const current = steps.indexOf(step);
  const blocked = !EVENT_ADDRESS || !ready || busy || !!registration || blocksRegistration(attempt) || !smartAccountClient;

  useEffect(() => {
    if (!EVENT_ADDRESS || !smartAccountClient) return;
    let active = true;
    const load = async () => {
      try {
        const result = await recoverEventRegistration(smartAccountClient);
        if (!active) return;
        if (result) { setRegistration(result); setStep("complete"); }
      } catch (error) {
        if (active) setMessage(error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "受取状況を読み込めませんでした。");
      } finally {
        try {
          const saved = await getRegistrationAttempt(EVENT_ADDRESS!, address);
          if (active) { setAttempt(saved); setReady(true); }
        } catch { if (active) { setReady(false); setMessage("参加登録の保存状態を読み込めません。再送せず保存領域を確認してください。"); } }
      }
    };
    void load();
    return () => { active = false; };
  }, [address, smartAccountClient]);

  useEffect(() => {
    if (registration && !notified.current) { notified.current = true; onRegistered(); }
  }, [registration, onRegistered]);

  const run = async (send: boolean) => {
    if (lock.current || !smartAccountClient || !EVENT_ADDRESS) return;
    if (send && (blocked || step !== "confirm" || !nickname.trim())) return;
    lock.current = true; setBusy(true);
    setMessage(send ? "参加特典を準備しています。画面を閉じずにお待ちください。" : "受取状況を確認しています…（送信しません）");
    try {
      const result = send
        ? await registerForEvent(smartAccountClient, (hash) => { setOperationHash(hash); setMessage("送信済みです。JPYCと参加証NFTの受取を確認しています…"); })
        : await recoverEventRegistration(smartAccountClient);
      if (result) {
        setRegistration(result); setStep("complete"); setMessage("1 JPYCと参加証NFTの配布を確認しました。");
      } else setMessage("まだ参加登録されていません。保存状態が結果不明の場合は再送せず、時間をおいて確認してください。");
    } catch (error) {
      const detail = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "通信エラー";
      setMessage(`${send ? "登録完了を確認できませんでした。" : "受取状況を確定できませんでした。"}${detail}`);
    } finally {
      try { setAttempt(await getRegistrationAttempt(EVENT_ADDRESS, address)); setReady(true); }
      catch { setReady(false); }
      lock.current = false; setBusy(false);
    }
  };

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus();
  }, [step]);

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nickname.trim() || blocked) return;
    setNickname(nickname.trim());
    setStep("confirm");
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
        <div className="bg-soft px-6 py-9 text-center">
          <p className="text-xs font-semibold tracking-[0.22em] text-accent">LIVE & EVENT</p>
          <p className="mt-3 text-2xl font-semibold text-ink">今日の思い出を、ひとつ。</p>
          <p className="mt-2 text-sm text-muted">あなたの参加が、特別な記念に。</p>
        </div>
        <div className="space-y-4 p-6">
          <div><span className="rounded-full bg-soft px-3 py-1 text-xs font-medium text-accent">参加無料</span><h2 className="mt-3 text-xl font-semibold">{eventName}</h2><p className="mt-1 text-sm text-muted">イベント当日に、会場から参加登録してください。</p></div>
          <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm"><dt className="text-muted">日時</dt><dd>決まり次第お知らせします</dd><dt className="text-muted">会場</dt><dd>決まり次第お知らせします</dd></dl>
          <div className="rounded-2xl bg-soft p-4"><p className="text-sm font-semibold text-accent">参加特典</p><p className="mt-1 font-medium">1 JPYC ＋ 参加証NFT</p><p className="mt-2 text-xs text-muted">参加登録すると、ログイン中のウォレットへテスト用JPYCと参加証をお届けします。受取は1ウォレットにつき1回です。</p></div>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-soft space-y-6" aria-labelledby="registration-heading">
        <ol aria-label="参加登録の手順" className="flex justify-between gap-3">
          {labels.map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className={`flex flex-1 items-center gap-2 text-sm ${current >= index ? "font-semibold text-accent" : "text-muted"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${current >= index ? "bg-accent text-accent-ink" : "bg-soft"}`}>{current > index ? "✓" : index + 1}</span>{label}</li>)}
        </ol>

        <div>
          <h2 id="registration-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{step === "input" ? "イベント参加登録" : step === "confirm" ? "登録内容の確認" : "参加登録が完了しました"}</h2>
          <p className="mt-2 text-sm text-muted">{step === "input" ? "会場で使うニックネームを教えてください。" : step === "confirm" ? "この内容で登録してよろしいですか？" : nickname ? `${nickname}さん、ご参加ありがとうございます。` : "ご参加ありがとうございます。"}</p>
        </div>

        {step === "input" && <form onSubmit={confirm} className="space-y-5">
          <div><label htmlFor="participant-nickname" className="text-sm font-medium">ニックネーム <span className="ml-1 text-xs text-accent">必須</span></label><input id="participant-nickname" name="nickname" type="text" autoComplete="nickname" required maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：はな" aria-describedby="nickname-help" className="mt-2 w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink" /><p id="nickname-help" className="mt-2 text-xs text-muted">本名でなくて大丈夫です。30文字以内で入力してください。</p></div>
          <button type="submit" disabled={!nickname.trim() || blocked} className={primary}>登録内容を確認する</button>
        </form>}

        {step === "confirm" && <div className="space-y-5">
          <dl className="rounded-2xl bg-soft p-4 space-y-4 text-sm"><div><dt className="text-muted">参加イベント</dt><dd className="mt-1 font-medium">{eventName}</dd></div><div><dt className="text-muted">ニックネーム</dt><dd className="mt-1 break-words font-medium">{nickname}</dd></div><div><dt className="text-muted">参加特典</dt><dd className="mt-1 font-medium">テスト用1 JPYC・参加証NFT 1枚</dd></div><div><dt className="text-muted">ネットワーク</dt><dd>Ethereum Sepolia</dd></div><div><dt className="text-muted">受取先</dt><dd className="break-all font-mono text-xs">{address}</dd></div></dl>
          <p className="text-xs text-muted">登録時に手数料スポンサーを確認します。確認できなければ送信せず、自己負担送信への自動切り替えはしません。</p>
          <button type="button" onClick={() => run(true)} disabled={blocked} className={primary}>{busy ? "受取を確認しています…" : "この内容で参加登録して特典を受け取る"}</button>
          <button type="button" disabled={busy || blocksRegistration(attempt)} onClick={() => setStep("input")} className="w-full text-sm text-accent underline disabled:opacity-50">入力内容を修正する</button>
        </div>}

        {step === "complete" && registration && <div className="space-y-5">
          <div className="rounded-2xl bg-soft px-5 py-6 text-center"><span aria-hidden="true" className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl text-accent-ink">✓</span><p className="mt-3 font-semibold">{eventName}</p>{nickname && <p className="mt-2 break-words text-sm">{nickname} さん</p>}<p className="mt-2 text-xs text-accent">参加登録・特典配布を確認済み</p></div>
          <div className="rounded-2xl border border-line p-4 space-y-3 text-sm"><p className="font-semibold">受け取った特典</p><p>テスト用 1 JPYC ＋ 参加証NFT 1枚</p><p className="text-muted">参加証 No. {registration.tokenId} ／ 登録日：{new Date(registration.registeredAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</p><a href={`https://sepolia.etherscan.io/token/${EVENT_ADDRESS}?a=${registration.tokenId}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">参加証NFTの発行記録を見る</a><p className="text-xs text-muted">この表示は登録時の配布実績です。現在の残高・NFTの保有状況は、ウォレットとNFTコレクションをご確認ください。</p></div>
        </div>}
        {!EVENT_ADDRESS && <p role="status" className="text-sm text-muted">主催者が配布の準備をしています。しばらくお待ちください。</p>}
        {EVENT_ADDRESS && <>
          <button type="button" disabled={busy || !smartAccountClient} onClick={() => run(false)} className="w-full text-sm text-accent underline disabled:opacity-50">受取状況を確認（送信しません）</button>
          <p className="text-xs text-muted">保存状態：{!ready ? "未確認" : attempt ? ({ processing: "処理中", unknown: "結果不明（再送せず受取状況を確認してください）", success: "成功確認済み", failed: "失敗確認済み（送信前中止を含む）" })[attempt.status] : "登録処理の記録なし"}</p>
        </>}
        <p role="status" aria-live="polite" className="break-words text-sm text-muted">{message}</p>
        {(attempt || operationHash) && <details className="text-xs text-muted"><summary>処理の確認情報</summary><div className="mt-2 space-y-2 break-all"><p>受取先：{address}</p><p>配布元：{EVENT_ADDRESS}</p>{attempt && <p>開始日時：{attempt.startedAt} ／ nonce：{attempt.nonce ?? "未取得"}</p>}{(attempt?.operationHash || operationHash) && <p>UserOperation：{attempt?.operationHash || operationHash}</p>}{attempt?.transactionHash && <a href={`https://sepolia.etherscan.io/tx/${attempt.transactionHash}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">配布取引を見る</a>}</div></details>}
      </section>
      <p className="px-2 text-center text-xs text-muted">Sepoliaテストネットを使った研究用アプリです。JPYCは実際のお金や商品に交換できません。<br />ニックネームは画面表示だけに使い、保存・送信しません。ウォレットの参加登録・配布記録は公開されます。<br />参加登録の証明であり、会場への来場を証明するものではありません。</p>
    </div>
  );
}
