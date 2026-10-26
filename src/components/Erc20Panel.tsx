"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { getErc20Balance } from "@/lib/erc20";
import {
  getContracts,
  addContract,
  removeContract,
  hasContract,
} from "@/lib/contractHistory";
import { formatUnits, parseUnits, type Address } from "viem";

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_DEFAULT_ERC20_ADDRESS ?? "";

const inputCls =
  "w-full px-3 py-2 border border-line rounded-lg bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

const actionBtnCls =
  "px-4 py-2 bg-soft hover:bg-accent-disabled text-ink disabled:opacity-50 rounded-2xl text-sm transition-colors";

type TokenEntry = {
  address: string;
  symbol: string;
  balance: string;
  decimals: number;
  isLoading: boolean;
  error: string | null;
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Erc20Panel() {
  const { address: walletAddress, sendErc20 } = useWallet();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [inputAddr, setInputAddr] = useState("");

  // 送金フォームの状態
  const [selectedToken, setSelectedToken] = useState<TokenEntry | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const updateToken = useCallback((tokenAddr: string, patch: Partial<TokenEntry>) => {
    setTokens((prev) =>
      prev.map((t) =>
        t.address.toLowerCase() === tokenAddr.toLowerCase() ? { ...t, ...patch } : t
      )
    );
    // 送金フォームで選択中のトークンも更新
    setSelectedToken((prev) =>
      prev?.address.toLowerCase() === tokenAddr.toLowerCase()
        ? { ...prev, ...patch }
        : prev
    );
  }, []);

  const fetchToken = useCallback(
    async (tokenAddr: string) => {
      if (!walletAddress) return;

      const ZERO = "0x0000000000000000000000000000000000000000";
      if (tokenAddr.toLowerCase() === ZERO) return;

      setTokens((prev) => {
        const exists = prev.some(
          (t) => t.address.toLowerCase() === tokenAddr.toLowerCase()
        );
        if (exists) {
          return prev.map((t) =>
            t.address.toLowerCase() === tokenAddr.toLowerCase()
              ? { ...t, isLoading: true, error: null }
              : t
          );
        }
        return [
          ...prev,
          {
            address: tokenAddr,
            symbol: "",
            balance: "",
            decimals: 18,
            isLoading: true,
            error: null,
          },
        ];
      });

      try {
        const { balance, symbol, decimals } = await getErc20Balance(
          tokenAddr as Address,
          walletAddress as Address
        );
        const formatted = formatUnits(balance, decimals);

        if (balance === BigInt(0)) {
          // 残高0 → 履歴から削除
          removeContract("erc20", tokenAddr);
          setTokens((prev) =>
            prev.filter((t) => t.address.toLowerCase() !== tokenAddr.toLowerCase())
          );
          setSelectedToken((prev) =>
            prev?.address.toLowerCase() === tokenAddr.toLowerCase() ? null : prev
          );
        } else {
          addContract("erc20", tokenAddr);
          updateToken(tokenAddr, {
            isLoading: false,
            symbol,
            balance: formatted,
            decimals,
          });
        }
      } catch (err) {
        updateToken(tokenAddr, {
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [walletAddress, updateToken]
  );

  // ログイン時に保存済みトークンを自動取得
  useEffect(() => {
    if (!walletAddress) {
      setTokens([]);
      setSelectedToken(null);
      return;
    }

    // 環境変数のデフォルトアドレスが未登録なら履歴に追加
    const ZERO = "0x0000000000000000000000000000000000000000";
    if (
      DEFAULT_ADDRESS &&
      DEFAULT_ADDRESS !== ZERO &&
      !hasContract("erc20", DEFAULT_ADDRESS)
    ) {
      addContract("erc20", DEFAULT_ADDRESS);
    }

    const stored = getContracts("erc20").filter((a) => a !== ZERO);
    if (stored.length === 0) return;

    setTokens(
      stored.map((addr) => ({
        address: addr,
        symbol: "",
        balance: "",
        decimals: 18,
        isLoading: true,
        error: null,
      }))
    );
    stored.forEach((addr) => fetchToken(addr));
  }, [walletAddress, fetchToken]);

  const handleAdd = () => {
    const addr = inputAddr.trim();
    if (!addr) return;
    setInputAddr("");
    fetchToken(addr);
  };

  const handleRemove = (tokenAddr: string) => {
    removeContract("erc20", tokenAddr);
    setTokens((prev) =>
      prev.filter((t) => t.address.toLowerCase() !== tokenAddr.toLowerCase())
    );
    setSelectedToken((prev) =>
      prev?.address.toLowerCase() === tokenAddr.toLowerCase() ? null : prev
    );
  };

  const handleTransfer = async () => {
    if (!selectedToken) return;
    setSendError(null);
    setTxHash(null);
    setSendLoading(true);
    try {
      const hash = await sendErc20(
        selectedToken.address as Address,
        to.trim() as Address,
        parseUnits(amount, selectedToken.decimals)
      );
      setTxHash(hash);
      setTo("");
      setAmount("");
      // 残高を再取得
      await fetchToken(selectedToken.address);
    } catch (e: any) {
      setSendError(e.message ?? "送金に失敗しました");
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-3xl border border-line shadow-soft overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-soft transition-colors"
      >
        <h2 className="ribbon-heading font-semibold text-ink">
          ERC-20 トークン
          {tokens.filter((t) => !t.isLoading && t.balance).length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted">
              {tokens.filter((t) => !t.isLoading && t.balance).length} 種
            </span>
          )}
        </h2>
        <span className="text-muted text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4">
          {/* トークン一覧 */}
          {tokens.length > 0 && (
            <div className="divide-y divide-line border border-line rounded-xl overflow-hidden">
              {tokens.map((t) => (
                <div
                  key={t.address}
                  onClick={() => !t.isLoading && !t.error && setSelectedToken(t)}
                  className={`flex items-center justify-between px-4 py-3 transition-colors ${
                    !t.isLoading && !t.error
                      ? "cursor-pointer hover:bg-soft/50"
                      : ""
                  } ${
                    selectedToken?.address.toLowerCase() === t.address.toLowerCase()
                      ? "bg-soft"
                      : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {t.isLoading ? (
                      <span className="text-xs text-muted">
                        {shortAddr(t.address)} 取得中...
                      </span>
                    ) : t.error ? (
                      <span className="text-xs text-red-500 dark:text-red-400">
                        {shortAddr(t.address)} — エラー
                      </span>
                    ) : (
                      <>
                        <span className="text-base font-bold text-ink">
                          {t.balance}
                        </span>
                        <span className="ml-1 text-sm text-muted">
                          {t.symbol}
                        </span>
                        <span className="ml-2 text-xs text-muted">
                          {shortAddr(t.address)}
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(t.address);
                    }}
                    className="ml-2 text-muted hover:text-red-600 dark:hover:text-red-400 text-xs transition-colors"
                    title="削除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 送金フォーム（トークン選択時に表示） */}
          {selectedToken && !selectedToken.isLoading && !selectedToken.error && (
            <div className="space-y-3 border border-line rounded-xl p-4">
              <p className="text-sm font-medium text-ink">
                {selectedToken.symbol} を送金
              </p>
              <div>
                <label className="text-sm text-muted">送り先アドレス</label>
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="0x..."
                  className={`mt-1 font-mono text-sm ${inputCls}`}
                />
              </div>
              <div>
                <label className="text-sm text-muted">
                  送金額 ({selectedToken.symbol})
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1.0"
                  className={`mt-1 text-sm ${inputCls}`}
                />
              </div>
              {sendError && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
                  {sendError}
                </p>
              )}
              {txHash && (
                <div className="text-sm bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-lg">
                  <span className="text-green-700 dark:text-green-400 font-medium">成功！</span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-accent hover:underline font-mono text-xs"
                  >
                    Etherscan で確認 →
                  </a>
                </div>
              )}
              <button
                onClick={handleTransfer}
                disabled={sendLoading || !to || !amount}
                className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-disabled-ink text-accent-ink rounded-2xl font-medium transition-colors"
              >
                {sendLoading ? "送信中..." : `${selectedToken.symbol} を送金 (Gasless)`}
              </button>
            </div>
          )}

          {/* 新しいトークンを追加 */}
          <div>
            <label className="text-sm text-muted">トークンを追加</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={inputAddr}
                onChange={(e) => setInputAddr(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="0x..."
                className={`flex-1 font-mono text-xs ${inputCls}`}
              />
              <button onClick={handleAdd} disabled={!inputAddr.trim()} className={actionBtnCls}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
