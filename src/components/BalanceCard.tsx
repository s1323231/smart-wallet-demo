"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";

function IconClipboard() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function BalanceCard() {
  const { address, balance, refreshBalance } = useWallet();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-surface rounded-3xl border border-line shadow-soft p-6 space-y-2">
      <div className="text-sm text-muted">Smart Account アドレス</div>
      <div className="flex items-center gap-2">
        <div className="font-mono text-xs text-ink break-all flex-1">{address}</div>
        <button
          onClick={copyAddress}
          title={copied ? "コピーしました" : "アドレスをコピー"}
          className={`shrink-0 p-1.5 rounded transition-colors ${
            copied
              ? "text-green-500 dark:text-green-400"
              : "text-muted hover:text-accent"
          }`}
        >
          {copied ? <IconCheck /> : <IconClipboard />}
        </button>
      </div>
      <a
        href={`https://sepolia.etherscan.io/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-accent hover:underline"
      >
        Sepolia Etherscan ↗
      </a>
      <div className="text-sm text-muted pt-2">残高</div>
      <div className="text-3xl font-bold text-ink">
        {balance ?? "—"} <span className="text-lg font-normal text-muted">SepoliaETH</span>
      </div>
      <button
        onClick={refreshBalance}
        className="text-sm text-accent hover:underline"
      >
        更新
      </button>
    </div>
  );
}
