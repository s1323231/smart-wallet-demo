"use client";

import { useWallet } from "@/hooks/useWallet";

export function LoginButton() {
  const { isConnected, isLoading, login, logout, address } = useWallet();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted font-mono">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm text-ink bg-soft hover:bg-accent-disabled rounded-lg transition-colors"
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      disabled={isLoading}
      className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink text-accent-ink rounded-2xl font-medium transition-colors"
    >
      {isLoading ? "接続中..." : "Google でログイン"}
    </button>
  );
}
