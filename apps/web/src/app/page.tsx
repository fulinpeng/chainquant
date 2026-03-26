"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";

type TradeRecord = {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  profit: number;
};

type TradingBacktestResponse = {
  trades: TradeRecord[];
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
  };
};

function formatTime(tsSeconds: number) {
  if (!Number.isFinite(tsSeconds)) return "-";
  return new Date(tsSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

export default function Home() {
  const { address, isConnected, connect, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradingBacktestResponse | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (address) setInputAddress(address);
  }, [address]);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    [],
  );

  async function runStrategy() {
    const addr = inputAddress.trim();
    setError(null);
    setResult(null);

    if (!addr) {
      setError("请输入 address");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/copier/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });

      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const msg =
          typeof data === "object" && data && "message" in data
            ? String((data as { message?: unknown }).message)
            : `请求失败 (${res.status})`;
        throw new Error(msg);
      }

      setResult(data as TradingBacktestResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">ChainQuant</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">ChainQuant</h1>
          <p className="text-sm text-zinc-600">
            Delayed Copy Trading Engine（MVP Backtest）
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={connect}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-sm font-medium text-zinc-800">Address</label>
            <input
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-900"
            />
            {address && (
              <p className="text-xs text-zinc-500">
                已连接钱包：<span className="font-mono">{address}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={runStrategy}
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Running..." : "Run Strategy"}
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="grid gap-6">
          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-5 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">Total PnL</p>
              <p className="font-mono text-lg text-zinc-900">
                {result.stats.totalPnL.toFixed(4)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">Win Rate</p>
              <p className="font-mono text-lg text-zinc-900">
                {(result.stats.winRate * 100).toFixed(2)}%
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">Total Trades</p>
              <p className="font-mono text-lg text-zinc-900">
                {result.stats.totalTrades}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-3">
              <h2 className="text-sm font-medium text-zinc-900">Trades</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-600">
                  <tr>
                    <th className="px-5 py-3 font-medium">Entry Time</th>
                    <th className="px-5 py-3 font-medium">Entry Price</th>
                    <th className="px-5 py-3 font-medium">Exit Time</th>
                    <th className="px-5 py-3 font-medium">Exit Price</th>
                    <th className="px-5 py-3 font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {result.trades.map((t, idx) => (
                    <tr key={idx} className="text-zinc-800">
                      <td className="px-5 py-3 font-mono text-xs">
                        {formatTime(t.entryTime)}
                      </td>
                      <td className="px-5 py-3 font-mono">
                        {t.entryPrice.toFixed(4)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {formatTime(t.exitTime)}
                      </td>
                      <td className="px-5 py-3 font-mono">
                        {t.exitPrice.toFixed(4)}
                      </td>
                      <td
                        className={`px-5 py-3 font-mono ${
                          t.profit >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {t.profit.toFixed(4)}
                      </td>
                    </tr>
                  ))}

                  {!result.trades.length && (
                    <tr>
                      <td className="px-5 py-6 text-sm text-zinc-500" colSpan={5}>
                        没有产生交易
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
