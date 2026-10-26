"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { type Address } from "viem";

const inputCls =
  "w-full mt-1 px-3 py-2 border border-line rounded-lg bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

export function SendEth() {
  const { sendEth, sendEthGasless } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [gasless, setGasless] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setError(null);
    setTxHash(null);
    setIsLoading(true);
    try {
      const fn = gasless ? sendEthGasless : sendEth;
      const hash = await fn(to as Address, amount);
      setTxHash(hash);
      setTo("");
      setAmount("");
    } catch (e: any) {
      setError(e.message ?? "送金に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-3xl border border-line shadow-soft p-6 space-y-4">
      <h2 className="ribbon-heading font-semibold text-ink">SepoliaETH 送金</h2>

      <div>
        <label className="text-sm text-muted">送り先アドレス</label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x..."
          className={`font-mono text-sm ${inputCls}`}
        />
      </div>

      <div>
        <label className="text-sm text-muted">金額 (SepoliaETH)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.001"
          min="0"
          step="0.001"
          className={`text-sm ${inputCls}`}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="gasless"
          checked={gasless}
          onChange={(e) => setGasless(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="gasless" className="text-sm text-ink">
          Gasless 送金（Paymaster がガス代を負担）
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {txHash && (
        <div className="text-sm bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-lg">
          <span className="text-green-700 dark:text-green-400 font-medium">送金成功！</span>
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-accent hover:underline font-mono text-xs"
          >
            {txHash.slice(0, 10)}... Etherscan で確認 →
          </a>
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={isLoading || !to || !amount}
        className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink text-accent-ink rounded-2xl font-medium transition-colors"
      >
        {isLoading ? "送金中..." : gasless ? "Gasless で送金" : "送金"}
      </button>
    </div>
  );
}
