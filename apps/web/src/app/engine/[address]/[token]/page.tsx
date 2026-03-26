"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletHeader from "@/components/WalletHeader";

type EngineEvent = {
  id: string;
  type:
    | "SIGNAL"
    | "ENTRY"
    | "EXIT"
    | "INVALID_SIGNAL"
    | "COOLDOWN_BLOCK"
    | "ERROR";
  timestamp: number;
  price?: number;
  message?: string;
};

type Position = {
  id: string;
  token: string;
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN";
};

type Trade = {
  id: string;
  token: string;
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  status: "CLOSED";
};

type EngineDetail = {
  state: "IDLE" | "WAITING_ENTRY" | "IN_POSITION";
  position: Position | null;
  trades: Trade[];
  events: EngineEvent[];
  currentPrice: number | null;
};

function formatTimeMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function fmtNum(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

export default function EngineDetailPage({
  params,
}: {
  params: Promise<{ address: string; token: string }>;
}) {
  // Next.js 的类型对 `params` 在该场景可能被声明为 Promise，
  // 但运行时依然会提供对象；这里做兼容性断言。
  const p = params as unknown as { address?: string; token?: string };
  const address = decodeURIComponent(p.address ?? "");
  const token = decodeURIComponent(p.token ?? "");

  const [data, setData] = useState<EngineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchDetail = useCallback(async () => {
    try {
      const q = new URLSearchParams({ address, token });
      const res = await fetch(`${apiBaseUrl}/engine/detail?${q.toString()}`);
      const body = (await res.json()) as unknown;
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setError(null);
      setData(body as EngineDetail);
    } catch {
      setError("请求失败（engine/detail）");
    }
  }, [address, token, apiBaseUrl, parseApiError]);

  useEffect(() => {
    void fetchDetail();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void fetchDetail(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchDetail]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-oo-bg p-8 text-oo-text">
      <WalletHeader />

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">Engine 详情</h2>
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/"
            className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            Back
          </Link>
          <div className="min-w-0">
            <p className="text-xs text-oo-text-muted">
              address: <span className="font-mono text-oo-text break-all">{address}</span>
            </p>
            <p className="text-xs text-oo-text-muted">
              token: <span className="font-mono text-oo-text break-all">{token}</span>
            </p>
          </div>
        </div>
      </section>

      {error && (
        <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
          <p className="text-sm text-oo-error">{error}</p>
        </section>
      )}

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">当前状态</h2>
        <dl className="grid gap-2 text-sm text-oo-text-secondary md:grid-cols-2">
          <div>
            <dt className="text-xs text-oo-text-muted">state</dt>
            <dd className="font-mono text-oo-text">{data?.state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">currentPrice</dt>
            <dd className="font-mono text-oo-text">
              {fmtNum(data?.currentPrice)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">持仓</h2>
        {data?.position ? (
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-oo-border bg-oo-bg p-3 text-xs text-oo-text">
            {JSON.stringify(data.position, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-oo-text-muted">无持仓</p>
        )}
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">Trades</h2>
        <div className="overflow-x-auto rounded-lg border border-oo-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-oo-bg text-xs text-oo-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">side</th>
                <th className="px-3 py-2 font-medium">entry</th>
                <th className="px-3 py-2 font-medium">exit</th>
                <th className="px-3 py-2 font-medium">pnl</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {(data?.trades ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={4}>
                    暂无 trades
                  </td>
                </tr>
              ) : (
                (data?.trades ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {t.side}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {t.entryPrice.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {t.exitPrice.toFixed(4)}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono text-xs ${
                        t.pnl >= 0 ? "text-oo-success" : "text-oo-error"
                      }`}
                    >
                      {t.pnl.toFixed(4)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">Events</h2>
        <div className="overflow-x-auto rounded-lg border border-oo-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-oo-bg text-xs text-oo-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">价格</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {(data?.events ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={4}>
                    暂无 events
                  </td>
                </tr>
              ) : (
                [...(data?.events ?? [])].reverse().map((ev) => (
                  <tr key={ev.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-oo-text">
                      {formatTimeMs(ev.timestamp)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span
                        className={
                          ev.type === "ERROR"
                            ? "text-oo-error"
                            : ev.type === "EXIT"
                              ? "text-oo-success"
                              : ev.type === "INVALID_SIGNAL" ||
                                  ev.type === "COOLDOWN_BLOCK"
                                ? "text-amber-400"
                                : "text-oo-text"
                        }
                      >
                        {ev.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {fmtNum(ev.price)}
                    </td>
                    <td className="max-w-md truncate px-3 py-2 text-xs text-oo-text-muted">
                      {ev.message ?? "—"}
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

