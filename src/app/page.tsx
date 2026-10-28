"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { LoginButton } from "@/components/LoginButton";
import { BalanceCard } from "@/components/BalanceCard";
import { SendEth } from "@/components/SendEth";
import { Erc20Panel } from "@/components/Erc20Panel";
import { NftPanel } from "@/components/NftPanel";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { EventRecords } from "@/components/EventRecords";
import { JpycPanel } from "@/components/JpycPanel";

function Logo() {
  const [error, setError] = useState(false);
  if (error) {
    return <span className="text-xl font-bold text-ink">FujimuLab</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="FujimuLab"
      className="h-8 w-auto max-w-36 object-contain"
      onError={() => setError(true)}
    />
  );
}

export default function Home() {
  const { isInitialized, isConnected, address, error } = useWallet();

  return (
    <main className={`app-shell ${isConnected ? "max-w-5xl" : "max-w-lg"} mx-auto px-4 py-8 space-y-6`}>
      <div className="app-header flex flex-wrap items-center justify-between">
        <div>
          <Logo />
          <p className="text-xs text-muted">Inapp Wallet</p>
        </div>
        {isInitialized && isConnected && <LoginButton />}
      </div>

      <div className="diary-intro">
        <p className="text-xs font-semibold tracking-[0.18em] text-accent">MY OSHIKATSU DIARY</p>
        <h1 className="mt-2 text-xl font-semibold tracking-wide text-ink">推しとの思い出を、たいせつに。</h1>
        <p className="mt-2 text-sm text-muted">小さなときめきを、ひとつずつ。</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!isInitialized && !error && (
        <div className="text-center py-12 text-muted">初期化中...</div>
      )}

      {isInitialized && !isConnected && (
        <div className="rounded-3xl border border-line bg-surface px-6 py-12 text-center shadow-soft space-y-5">
          <p className="text-muted">
            Google アカウントでログインして<br />
            Smart Wallet を使ってみましょう
          </p>
          <LoginButton />
        </div>
      )}

      {isConnected && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <div className="px-1">
                <h2 className="text-lg font-semibold text-accent">イベント参加登録</h2>
                <p className="text-sm text-muted">参加するイベントを確認して、かんたんに登録。</p>
              </div>
              {address && <EventRegistrationForm key={address.toLowerCase()} />}
              {address && (
                <details className="rounded-3xl border border-line bg-surface p-5 shadow-soft">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">これまでの参加記録</summary>
                  <div className="mt-4"><EventRecords key={address.toLowerCase()} address={address} /></div>
                </details>
              )}
            </div>
            <div className="min-w-0 space-y-3">
              <div className="px-1">
                <h2 className="text-lg font-semibold text-accent">NFTコレクション</h2>
                <p className="text-sm text-muted">ウォレットに届いたNFTを並べて楽しもう。</p>
              </div>
              <NftPanel defaultOpen />
            </div>
          </div>
          <div className="mx-auto max-w-lg space-y-4">
            <BalanceCard />
            {address && <JpycPanel key={address.toLowerCase()} address={address} />}
            <SendEth />
            <Erc20Panel />
          </div>
        </div>
      )}
    </main>
  );
}
