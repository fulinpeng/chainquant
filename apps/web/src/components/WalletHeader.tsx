"use client";

import { useMemo } from "react";
import { useWallet } from "@/hooks/useWallet";

export default function WalletHeader() {
  const { isConnected, connect, disconnect } = useWallet();

  const walletButton = useMemo(() => {
    if (!isConnected) {
      return (
        <button
          type="button"
          onClick={() => connect()}
          className="rounded-lg bg-oo-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-oo-primary-hover"
        >
          Connect Wallet
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
      >
        Disconnect
      </button>
    );
  }, [isConnected, connect, disconnect]);

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-oo-text">
          ChainQuant
        </h1>
        <p className="text-sm text-oo-text-muted">
          链上跟单回调入场交易面板
        </p>
      </div>
      <div className="flex items-center gap-2">{walletButton}</div>
    </header>
  );
}

