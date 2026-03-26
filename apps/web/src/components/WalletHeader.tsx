"use client";

import { useMemo, useState } from "react";
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
  const { isConnected, address, chainId, connect, disconnect, switchChain } = useWallet();
  const [chainOpen, setChainOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const currentChain = CHAIN_OPTIONS.find((c) => c.id === chainId) ?? CHAIN_OPTIONS[0];
  const explorerUrl = `${currentChain.explorer}${address ?? ""}`;

  const walletButton = useMemo(() => {
    if (!isConnected) {
      return (
        <button
          type="button"
          onClick={() => connect()}
          className="rounded-lg bg-oo-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-oo-primary-hover"
        >
          连接钱包并登录
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
      >
        {shortAddress(address ?? "")}
      </button>
    );
  }, [isConnected, connect, address]);

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
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChainOpen((v) => !v)}
            className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            <span className="mr-2">{currentChain.icon}</span>
            {currentChain.label}
            <span className="ml-2">⌄</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-oo-border bg-oo-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-oo-text">Account Overview</h3>
              <button
                type="button"
                onClick={() => setAccountOpen(false)}
                className="rounded-full border border-oo-border-strong px-2 py-1 text-sm text-oo-text-muted hover:bg-oo-surface-hover"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-oo-border bg-oo-bg p-4">
              <div className="mb-4 break-all font-mono text-sm text-oo-text-secondary">
                {address ?? "--"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.open(explorerUrl, "_blank", "noopener,noreferrer")}
                  className="rounded-lg border border-oo-border-strong px-3 py-2 text-sm text-oo-text-secondary hover:bg-oo-surface-hover"
                >
                  区块浏览器
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(address ?? "")}
                  className="rounded-lg border border-oo-border-strong px-3 py-2 text-sm text-oo-text-secondary hover:bg-oo-surface-hover"
                >
                  复制地址
                </button>
                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    connect();
                  }}
                  className="rounded-lg border border-oo-border-strong px-3 py-2 text-sm text-oo-text-secondary hover:bg-oo-surface-hover"
                >
                  切换钱包
                </button>
                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    setAccountOpen(false);
                  }}
                  className="rounded-lg border border-oo-border-strong px-3 py-2 text-sm text-oo-error hover:bg-oo-surface-hover"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

