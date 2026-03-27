"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletHeader from "@/components/WalletHeader";

type EngineEvent = {
  id: string;
  type:
    | "SIGNAL"
    | "EXECUTION"
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
  size: number;
  exitTime: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  pnl: number | null;
  status: "OPEN" | "CLOSED";
};

type EngineDetail = {
  state: "IDLE" | "WAITING_ENTRY" | "IN_POSITION";
  position: Position | null;
  trades: Trade[];
  events: EngineEvent[];
  currentPrice: number | null;
  entryPrice: number | null;
  pendingSignalType: "BUY" | "SELL" | null;
  tickCount: number;
  lastUpdateTime: number;
  lastExitTick: number | null;
  cooldownCandles: number;
  cooldownTicksRemaining: number;
  running: boolean;
  mode: "MANUAL" | "AUTO";
};

function formatTimeMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function fmtNum(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function fmtTradeNum(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "--";
  return n.toFixed(6);
}

function extractTxHash(message?: string): string | null {
  if (!message) return null;
  const m = message.match(/\b0x[a-fA-F0-9]{64}\b/);
  return m ? m[0] : null;
}

export default function EngineDetailPage() {
  const routeParams = useParams<{ address?: string; token?: string }>();
  const address = decodeURIComponent(routeParams?.address ?? "");
  const token = decodeURIComponent(routeParams?.token ?? "");

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
          <div>
            <dt className="text-xs text-oo-text-muted">running</dt>
            <dd className="font-mono text-oo-text">{String(data?.running ?? false)}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">mode</dt>
            <dd className="font-mono text-oo-text">{data?.mode ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">entryPrice（持仓开仓价）</dt>
            <dd className="font-mono text-oo-text">
              {fmtNum(data?.entryPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">pendingSignal</dt>
            <dd className="font-mono text-oo-text">{data?.pendingSignalType ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">tickCount</dt>
            <dd className="font-mono text-oo-text">{data?.tickCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">lastUpdateTime</dt>
            <dd className="font-mono text-oo-text">
              {data?.lastUpdateTime ? formatTimeMs(data.lastUpdateTime) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">lastExitTick</dt>
            <dd className="font-mono text-oo-text">{data?.lastExitTick ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-oo-text-muted">cooldown</dt>
            <dd className="font-mono text-oo-text">
              {data?.cooldownCandles ?? "—"} ticks · 剩余{" "}
              {data?.cooldownTicksRemaining ?? 0}
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
                <th clas
