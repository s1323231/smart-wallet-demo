"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { getErc721Tokens, getErc1155Tokens, type NftToken } from "@/lib/nft";
import {
  getContracts,
  addContract,
  removeContract,
  hasContract,
  type TokenType,
} from "@/lib/contractHistory";
import type { Address } from "viem";

const DEFAULT_ERC721 = process.env.NEXT_PUBLIC_DEFAULT_ERC721_ADDRESS ?? "";
const DEFAULT_ERC1155 = process.env.NEXT_PUBLIC_DEFAULT_ERC1155_ADDRESS ?? "";

const inputCls =
  "flex-1 px-3 py-2 border border-line rounded-lg bg-surface text-ink font-mono text-xs placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent";

const actionBtnCls =
  "px-4 py-2 bg-soft hover:bg-accent-disabled text-ink disabled:opacity-50 rounded-2xl text-sm transition-colors";

type ContractEntry = {
  address: string;
  contractName: string;
  tokens: NftToken[];
  isLoading: boolean;
  error: string | null;
};

function NftCard({ token }: { token: NftToken }) {
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-soft">
      {token.metadata?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={token.metadata.image}
          alt={token.metadata.name ?? `#${token.tokenId}`}
          className="w-full aspect-square object-cover"
        />
      ) : (
        <div className="w-full aspect-square bg-soft flex items-center justify-center">
          <span className="text-muted text-xs">No Image</span>
        </div>
      )}
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-medium text-ink truncate">
          {token.metadata?.name ?? `#${token.tokenId}`}
        </p>
        <p className="text-xs text-muted">#{token.tokenId.toString()}</p>
        {token.balance !== undefined && (
          <p className="text-xs text-muted">×{token.balance.toString()}</p>
        )}
      </div>
    </div>
  );
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function NftSection({
  type,
  label,
  defaultAddress,
  fetcher,
  defaultOpen = false,
}: {
  type: TokenType;
  label: string;
  defaultAddress: string;
  defaultOpen?: boolean;
  fetcher: (contractAddr: Address, ownerAddr: Address) => Promise<{ tokens: NftToken[]; contractName?: string; contractSymbol?: string }>;
}) {
  const { address: walletAddress } = useWallet();
  const [open, setOpen] = useState(defaultOpen);
  const [entries, setEntries] = useState<ContractEntry[]>([]);
  const [inputAddr, setInputAddr] = useState("");

  const updateEntry = useCallback((contractAddr: string, patch: Partial<ContractEntry>) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.address.toLowerCase() === contractAddr.toLowerCase() ? { ...e, ...patch } : e
      )
    );
  }, []);

  const fetchContract = useCallback(
    async (contractAddr: string) => {
      if (!walletAddress) return;

      // 既存エントリがあればローディング状態に、なければ追加
      setEntries((prev) => {
        const exists = prev.some(
          (e) => e.address.toLowerCase() === contractAddr.toLowerCase()
        );
        if (exists) {
          return prev.map((e) =>
            e.address.toLowerCase() === contractAddr.toLowerCase()
              ? { ...e, isLoading: true, error: null }
              : e
          );
        }
        return [
          ...prev,
          { address: contractAddr, contractName: "", tokens: [], isLoading: true, error: null },
        ];
      });

      try {
        const result = await fetcher(contractAddr as Address, walletAddress as Address);

        if (result.tokens.length === 0) {
          // トークンが0件 → 履歴から削除してUIからも除去
          removeContract(type, contractAddr);
          setEntries((prev) =>
            prev.filter((e) => e.address.toLowerCase() !== contractAddr.toLowerCase())
          );
        } else {
          addContract(type, contractAddr);
          updateEntry(contractAddr, {
            isLoading: false,
            tokens: result.tokens,
            contractName:
              (result as any).contractName ||
              (result as any).contractSymbol ||
              "",
          });
        }
      } catch (err) {
        // エラー時は履歴に残す（一時的な障害の可能性）
        updateEntry(contractAddr, {
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [walletAddress, type, fetcher, updateEntry]
  );

  // ログイン時に保存済みコントラクトを自動取得
  useEffect(() => {
    if (!walletAddress) {
      setEntries([]);
      return;
    }

    // 環境変数のデフォルトアドレスが未登録なら履歴に追加
    if (defaultAddress && !hasContract(type, defaultAddress)) {
      addContract(type, defaultAddress);
    }

    const stored = getContracts(type);
    if (stored.length === 0) return;

    setEntries(
      stored.map((addr) => ({
        address: addr,
        contractName: "",
        tokens: [],
        isLoading: true,
        error: null,
      }))
    );
    stored.forEach((addr) => fetchContract(addr));
  }, [walletAddress, type, defaultAddress, fetchContract]);

  const handleAdd = () => {
    const addr = inputAddr.trim();
    if (!addr) return;
    setInputAddr("");
    fetchContract(addr);
  };

  const handleRemove = (contractAddr: string) => {
    removeContract(type, contractAddr);
    setEntries((prev) =>
      prev.filter((e) => e.address.toLowerCase() !== contractAddr.toLowerCase())
    );
  };

  const totalCount = entries.reduce((n, e) => n + e.tokens.length, 0);

  return (
    <div className="bg-surface rounded-3xl border border-line shadow-soft overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-soft transition-colors"
      >
        <h2 className="ribbon-heading font-semibold text-ink">
          {label}
          {totalCount > 0 && (
            <span className="ml-2 text-xs font-normal text-muted">
              {totalCount} 件
            </span>
          )}
        </h2>
        <span className="text-muted text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4">
          {/* 追跡中コントラクトの結果一覧 */}
          {entries.map((entry) => (
            <div
              key={entry.address}
              className="border border-line rounded-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 bg-soft">
                <span className="text-xs text-muted font-medium">
                  {entry.contractName
                    ? `${entry.contractName} (${shortAddr(entry.address)})`
                    : shortAddr(entry.address)}
                </span>
                <button
                  onClick={() => handleRemove(entry.address)}
                  className="text-muted hover:text-red-600 dark:hover:text-red-400 text-xs px-1 transition-colors"
                  title="このコントラクトを削除"
                >
                  ✕
                </button>
              </div>

              {entry.isLoading && (
                <p className="text-xs text-muted px-3 py-3">取得中...</p>
              )}
              {entry.error && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-2">
                  {entry.error}
                </p>
              )}
              {!entry.isLoading && !entry.error && entry.tokens.length > 0 && (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {entry.tokens.map((t) => (
                    <NftCard key={t.tokenId.toString()} token={t} />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* 新しいコントラクトを追加 */}
          <div>
            <label className="text-sm text-muted">コントラクトを追加</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={inputAddr}
                onChange={(e) => setInputAddr(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="0x..."
                className={inputCls}
              />
              <button
                onClick={handleAdd}
                disabled={!inputAddr.trim()}
                className={actionBtnCls}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NftPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <>
      <NftSection
        type="erc721"
        label="ERC-721 NFT"
        defaultOpen={defaultOpen}
        defaultAddress={DEFAULT_ERC721}
        fetcher={async (c, o) => {
          const r = await getErc721Tokens(c, o);
          return { tokens: r.tokens, contractName: r.contractName, contractSymbol: r.contractSymbol };
        }}
      />
      <NftSection
        type="erc1155"
        label="ERC-1155 NFT"
        defaultOpen={defaultOpen}
        defaultAddress={DEFAULT_ERC1155}
        fetcher={async (c, o) => {
          const r = await getErc1155Tokens(c, o);
          return { tokens: r.tokens };
        }}
      />
    </>
  );
}
