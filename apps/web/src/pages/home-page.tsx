"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletHeader from "@/components/WalletHeader";

type EngineListItem = {
  address: string;
  token: string;
  state: "IDLE" | "WAITING_ENTRY" | "IN_POSITION";
  entryPrice?: number;
  currentPrice?: number;
  pnl?: number;
};

function fmtNum(n: number | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [inputToken, setInputToken] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineList, setEngineList] = useState<EngineListItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setMounted(true), []);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    [],
  );

  const parseApiError = useCallback((data: unknown, status: number) => {
    if (typeof data === "object" && data && "message" in data) {
      return String((data as { message?: unknown }).message);
    }
    return `请求失败 (${status})`;
  }, []);

  const fetchEngineList = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/engine/list`);
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        setError(parseApiError(data, res.status));
        return;
      }
      setError(null);
      setEngineList(Array.isArray(data) ? (data as EngineListItem[]) : []);
    } catch {
      setError("请求失败（engine/list）");
    }
  }, [apiBaseUrl, parseApiError]);

  useEffect(() => {
    void fetchEngineList();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void fetchEngineList(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchEngineList]);

  async function sendTestSignal() {
    const addr = inputAddress.trim();
    const token = inputToken.trim();
    const price = Number(inputPrice);
    setError(null);
    if (!addr) {
      setError("请输入 address");
      return;
    }
    if (!token) {
      setError("请输入 token");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("请输入有效 price");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/engine/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, token, price }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      await fetchEngineList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送信号失败");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-oo-bg p-8 text-oo-text">
        <h1 className="text-2xl font-semibold tracking-tight">ChainQuant</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-oo-bg p-8 text-oo-text">
      <WalletHeader />

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">
          最小测试入口（/engine/signal）
        </h2>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-oo-text-muted">
            Address
            <input
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 font-mono text-sm text-oo-text outline-none placeholder:text-oo-text-muted focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-oo-text-muted">
            Token
            <input
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="0x token..."
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 font-mono text-sm text-oo-text outline-none placeholder:text-oo-text-muted focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-oo-text-muted">
            Price
            <input
              value={inputPrice}
              onChange={(e) => setInputPrice(e.target.value)}
              placeholder="例如 3200.5"
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 font-mono text-sm text-oo-text outline-none placeholder:text-oo-text-muted focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            />
          </label>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void sendTestSignal()}
            disabled={busy}
            className="rounded-lg bg-oo-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-oo-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            发送测试信号（BUY）
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-oo-error">{error}</p>}
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-oo-text">
            Engine 列表（/engine/list）
          </h2>
          <button
            type="button"
            onClick={() => void fetchEngineList()}
            className="rounded-lg border border-oo-border-strong px-3 py-1.5 text-xs text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            刷新
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-oo-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-oo-bg text-xs text-oo-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">address</th>
                <th className="px-3 py-2 font-medium">token</th>
                <th className="px-3 py-2 font-medium">state</th>
                <th className="px-3 py-2 font-medium">current</th>
                <th className="px-3 py-2 font-medium">entry</th>
                <th className="px-3 py-2 font-medium">pnl</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {engineList.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={7}>
                    暂无 Engine；请先发送测试信号。
                  </td>
                </tr>
              ) : (
                engineList.map((e) => (
                  <tr key={`${e.address}_${e.token}`}>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text break-all">
                      {e.address}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text break-all">
                      {e.token}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {e.state}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {fmtNum(e.currentPrice)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {fmtNum(e.entryPrice)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {fmtNum(e.pnl)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Link
                        className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                        href={`/engine/${encodeURIComponent(e.address)}/${encodeURIComponent(e.token)}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}