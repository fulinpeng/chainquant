"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";

type ChainOption = {
  id: number;
  label: string;
  icon: string;
  explorer: string;
};

const CHAIN_OPTIONS: ChainOption[] = [
  { id: 1, label: "Ethereum", icon: "🔷", explorer: "https://etherscan.io/address/" },
  { id: 8453, label: "Base", icon: "🟦", explorer: "https://basescan.org/address/" },
  { id: 10, label: "Optimism", icon: "🔴", explorer: "https://optimistic.etherscan.io/address/" },
  { id: 42161, label: "Arbitrum", icon: "🧿", explorer: "https://arbiscan.io/address/" },
  { id: 56, label: "BNB Chain", icon: "🟡", explorer: "https://bscscan.com/address/" },
];

function shortAddress(addr: string) {
  if (!addr) return "";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 4)}**${addr.slice(-3)}`;
}

export default function WalletHeader() {
  const {
    isConnected,
    address,
    chainId,
    connect,
    disconnect,
    switchChain,
    balanceFormatted,
    balanceSymbol,
    isBalanceLoading,
  } = useWallet();
  const [chainOpen, setChainOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const chainMenuRef = useRef<HTMLDivElement | null>(null);

  const currentChain = CHAIN_OPTIONS.find((c) => c.id === chainId) ?? CHAIN_OPTIONS[0];
  const explorerUrl = `${currentChain.explorer}${address ?? ""}`;
  const balanceText = useMemo(() => {
    if (!isConnected) return "--";
    if (isBalanceLoading) return "...";
    if (!balanceFormatted) return "--";
    const value = Number(balanceFormatted);
    if (!Number.isFinite(value)) return "--";
    return `${value.toFixed(4)} ${balanceSymbol ?? ""}`.trim();
  }, [isConnected, isBalanceLoading, balanceFormatted, balanceSymbol]);

  const walletButton = useMemo(() => {
    if (!isConnected) {
      return (
        <button
          type="button"
          onClick={() => connect()}
          className="h-10 rounded-lg bg-oo-primary px-4 py-0 text-sm font-medium text-white transition hover:bg-oo-primary-hover"
        >
          连接钱包并登录
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="h-10 rounded-lg border border-oo-border-strong px-4 py-0 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
      >
        {shortAddress(address ?? "")}
      </button>
    );
  }, [isConnected, connect, address]);

  useEffect(() => {
    if (!chainOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (chainMenuRef.current?.contains(target)) return;
      setChainOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [chainOpen]);

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-oo-text">
            ChainQuant
          </h1>
          <p className="text-sm text-oo-text-muted">
            链上跟单回调入场交易面板
          </p>
        </div>
        <div ref={chainMenuRef} className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChainOpen((v) => !v)}
            className="inline-flex h-10 items-center rounded-lg border border-oo-border-strong px-4 py-0 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            <span className="mr-2 inline-flex items-center leading-none">{currentChain.icon}</span>
            <span className="inline-flex items-center leading-none">{currentChain.label}</span>
            <span className="ml-2 inline-flex items-center leading-none text-oo-text-muted">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {chainOpen && (
            <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-oo-border bg-oo-surface p-2 shadow-lg">
              <div className="mb-2 px-2 py-1 text-xs text-oo-text-muted">选择网络</div>
              <div className="flex flex-col gap-1">
                {CHAIN_OPTIONS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      switchChain({ chainId: c.id });
                      setChainOpen(false);
                    }}
                    className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                      c.id === currentChain.id
                        ? "bg-oo-surface-hover text-oo-text"
                        : "text-oo-text-secondary hover:bg-oo-surface-hover"
                    }`}
                  >
                    <span className="mr-2">{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {walletButton}
        </div>
      </header>

      {accountOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setAccountOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-oo-border bg-oo-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-2xl font-semibold leading-none text-oo-text">Account Overview</h3>
              <button
                type="button"
                onClick={() => setAccountOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-oo-border-strong text-lg text-oo-text-muted transition hover:bg-oo-surface-hover hover:text-oo-text"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl border border-oo-border bg-oo-bg px-4 py-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate pr-1 font-mono text-2xl font-semibold leading-none text-oo-text-muted">
                    {address ? shortAddress(address).replace("**", "****") : "--"}
                  </div>
                  <button
                    type="button"
                    title="区块浏览器"
                    onClick={() => window.open(explorerUrl, "_blank", "noopener,noreferrer")}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-oo-text-muted transition hover:bg-oo-surface-hover hover:text-oo-text"
                    aria-label="区块浏览器"
                  >
                    ↗
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-2 text-oo-text-muted">
                  <button
                    type="button"
                    title="复制地址"
                    onClick={() => navigator.clipboard.writeText(address ?? "")}
                    className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-oo-surface-hover hover:text-oo-text"
                    aria-label="复制地址"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    title="切换钱包"
                    onClick={() => {
                      disconnect();
                      connect();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-oo-surface-hover hover:text-oo-text"
                    aria-label="切换钱包"
                  >
                    ⇄
                  </button>
                  <button
                    type="button"
                    title="退出登录"
                    onClick={() => {
                      disconnect();
                      setAccountOpen(false);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-oo-surface-hover hover:text-oo-text"
                    aria-label="退出登录"
                  >
                    ⇥
                  </button>
                </div>
              </div>
              <div className="text-center text-3xl font-semibold text-[#ff7a1a]">{balanceText}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

