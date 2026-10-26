"use client";

import { useEffect, useState, type FormEvent } from "react";

type EventRecord = {
  id: string;
  name: string;
  date: string;
};

const inputCls =
  "w-full mt-1 px-3 py-2 border border-line rounded-lg bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-accent";

export function EventRecords({ address }: { address: string }) {
  const [records, setRecords] = useState<EventRecord[]>([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `inapp-wallet-events:${address.toLowerCase()}`;

  useEffect(() => {
    // ブラウザでのみ読み込む。読み込み時には保存しないので既存記録を上書きしない。
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (record) =>
            record !== null &&
            typeof record === "object" &&
            typeof record.id === "string" &&
            typeof record.name === "string" &&
            typeof record.date === "string"
        )
      ) {
        throw new Error("Invalid records");
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageから保存済み記録を復元する。
      setRecords(parsed);
      setIsReady(true);
    } catch {
      setError("参加記録を読み込めませんでした。ブラウザの保存設定をご確認ください。");
    }
  }, [storageKey]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady || !name.trim() || !date) return;

    const nextRecords = [
      { id: crypto.randomUUID(), name: name.trim(), date },
      ...records,
    ];
    try {
      // 保存に成功したときだけ一覧と入力欄を更新する。
      localStorage.setItem(storageKey, JSON.stringify(nextRecords));
      setRecords(nextRecords);
      setName("");
      setDate("");
      setError(null);
    } catch {
      setError("参加記録を保存できませんでした。ブラウザの保存設定や空き容量をご確認ください。");
    }
  };

  return (
    <section className="bg-surface rounded-3xl border border-line shadow-soft p-6 space-y-4">
      <h2 className="ribbon-heading font-semibold text-ink">イベント参加記録</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="event-name" className="text-sm text-muted">
            LIVE・イベント名
          </label>
          <input
            id="event-name"
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例：推しの夏ライブ"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="event-date" className="text-sm text-muted">
            参加日
          </label>
          <input
            id="event-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={!isReady || !name.trim() || !date}
          className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink text-accent-ink rounded-2xl font-medium transition-colors"
        >
          参加記録を登録
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-muted">
        記録はこのブラウザに保存されます。別の端末には引き継がれません。
      </p>
      <div aria-live="polite">
        <h3 className="text-sm font-medium text-ink">
          登録した参加記録（{records.length}件）
        </h3>
        {!isReady && !error && <p className="mt-2 text-sm text-muted">読み込み中...</p>}
        {isReady && records.length === 0 && (
          <p className="mt-2 text-sm text-muted">まだ参加記録はありません。</p>
        )}
        <ul className="mt-2 divide-y divide-line">
          {records.map((record) => (
            <li key={record.id} className="py-3 space-y-1">
              <p className="text-sm font-medium text-ink break-words">{record.name}</p>
              <time dateTime={record.date} className="text-sm text-muted">
                {record.date.replaceAll("-", "/")}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
