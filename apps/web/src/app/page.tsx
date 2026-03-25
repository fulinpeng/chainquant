"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";

export default function Home() {
  const { address, isConnected, connect, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">ChainQuant</h1>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">ChainQuant</h1>

      {!isConnected ? (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={connect}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="flex max-w-2xl flex-col items-center gap-3 text-center">
          <p className="text-sm text-zinc-500">Connected Wallet Address</p>
          <p className="break-all font-mono text-sm text-zinc-900">{address}</p>
          <button
            type="button"
            onClick={() => disconnect()}
            className="mt-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
          >
            Disconnect
          </button>
        </div>
      )}
    </main>
  );
}
