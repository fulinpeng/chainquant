"use client";

import { useMemo, type ReactNode } from "react";
import { useWallet } from "@/hooks/useWallet";

export default function WalletHeader({
  left,
}: {
  left: ReactNode;
}) {
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
      {left}
      <div className="flex items-center gap-2">{walletButton}</div>
    </header>
  );
}

