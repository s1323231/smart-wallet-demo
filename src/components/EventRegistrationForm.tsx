"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Step = "input" | "confirm" | "complete";
const steps: Step[] = ["input", "confirm", "complete"];
const labels = ["入力", "確認", "完了"];
const primary = "w-full rounded-2xl bg-accent px-4 py-3 font-semibold text-accent-ink hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink";

export function EventRegistrationForm() {
  const [step, setStep] = useState<Step>("input");
  const [nickname, setNickname] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<Step>("input");
  const current = steps.indexOf(step);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    heading.current?.focus();
  }, [step]);

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nickname.trim()) return;
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
          <div><span className="rounded-full bg-soft px-3 py-1 text-xs font-medium text-accent">参加無料</span><h2 className="mt-3 text-xl font-semibold">LIVE・イベント参加記録</h2><p className="mt-1 text-sm text-muted">イベント当日に、会場から参加登録してください。</p></div>
          <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm"><dt className="text-muted">日時</dt><dd>決まり次第お知らせします</dd><dt className="text-muted">会場</dt><dd>決まり次第お知らせします</dd></dl>
          <div className="rounded-2xl bg-soft p-4"><p className="text-sm font-semibold text-accent">参加特典</p><p className="mt-1 font-medium">1ポイント ＋ デジタル参加証</p><p className="mt-2 text-xs text-muted">テスト用JPYCのポイントと、NFTの参加証を配布する予定です。</p></div>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-soft space-y-6" aria-labelledby="registration-heading">
        <ol aria-label="参加登録の手順" className="flex justify-between gap-3">
          {labels.map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className={`flex flex-1 items-center gap-2 text-sm ${current >= index ? "font-semibold text-accent" : "text-muted"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${current >= index ? "bg-accent text-accent-ink" : "bg-soft"}`}>{current > index ? "✓" : index + 1}</span>{label}</li>)}
        </ol>

        <div>
          <h2 id="registration-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{step === "input" ? "イベント参加登録" : step === "confirm" ? "登録内容の確認" : "参加登録が完了しました"}</h2>
          <p className="mt-2 text-sm text-muted">{step === "input" ? "会場で使うニックネームを教えてください。" : step === "confirm" ? "この内容で登録してよろしいですか？" : `${nickname}さん、ご参加ありがとうございます。`}</p>
        </div>

        {step === "input" && <form onSubmit={confirm} className="space-y-5">
          <div><label htmlFor="participant-nickname" className="text-sm font-medium">ニックネーム <span className="ml-1 text-xs text-accent">必須</span></label><input id="participant-nickname" name="nickname" type="text" autoComplete="nickname" required maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：はな" aria-describedby="nickname-help" className="mt-2 w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink" /><p id="nickname-help" className="mt-2 text-xs text-muted">本名でなくて大丈夫です。30文字以内で入力してください。</p></div>
          <button type="submit" disabled={!nickname.trim()} className={primary}>登録内容を確認する</button>
        </form>}

        {step === "confirm" && <div className="space-y-5">
          <dl className="rounded-2xl bg-soft p-4 space-y-4 text-sm"><div><dt className="text-muted">参加イベント</dt><dd className="mt-1 font-medium">LIVE・イベント参加記録</dd></div><div><dt className="text-muted">ニックネーム</dt><dd className="mt-1 break-words font-medium">{nickname}</dd></div><div><dt className="text-muted">参加特典（配布予定）</dt><dd className="mt-1 font-medium">1ポイント・デジタル参加証</dd></div></dl>
          <p className="text-xs text-muted">これは画面確認用の登録です。主催者への送信や特典の配布は行いません。</p>
          <button onClick={() => setStep("complete")} className={primary}>この内容で参加登録する</button>
          <button onClick={() => setStep("input")} className="w-full text-sm text-accent underline">入力内容を修正する</button>
        </div>}

        {step === "complete" && <div className="space-y-5">
          <div className="rounded-2xl bg-soft px-5 py-6 text-center"><span aria-hidden="true" className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl text-accent-ink">✓</span><p className="mt-3 font-semibold">LIVE・イベント参加記録</p><p className="mt-2 break-words text-sm">{nickname} さん</p><p className="mt-2 text-xs text-accent">参加登録済み（画面デモ）</p></div>
          <div className="rounded-2xl border border-dashed border-line p-4 text-sm"><p className="font-medium">参加特典について</p><p className="mt-2 text-muted">ポイントとデジタル参加証を受け取る機能は、これから接続します。現在はまだ配布されていません。</p></div>
          <button onClick={() => { setNickname(""); setStep("input"); }} className="w-full text-sm text-accent underline">最初の画面に戻る</button>
        </div>}
      </section>
      <p className="px-2 text-center text-xs text-muted">画面プレビュー：実際のイベントへの登録・送金・NFT発行は行いません。<br />入力内容は保存・送信されず、再読み込みすると消えます。</p>
    </div>
  );
}
