"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type EngineClosedTrade = {
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

type EngineTradingResultResponse = {
  trades: EngineClosedTrade[];
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
  };
};

type EngineStatus = {
  running: boolean;
  mode: "MANUAL" | "AUTO";
  state: "IDLE" | "WAITING_ENTRY" | "IN_POSITION";
  currentPrice: number | null;
  entryPrice: number | null;
  pendingSignalType: "BUY" | "SELL" | null;
  position: {
    id: string;
    token: string;
    side: "LONG" | "SHORT";
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    status: "OPEN";
  } | null;
  tickCount: number;
  lastUpdateTime: number;
  lastExitTick: number | null;
  cooldownCandles: number;
  cooldownTicksRemaining: number;
  address: string | null;
};

type CopierEventRecord = {
  id: string;
  type:
    | "SIGNAL"
    | "ENTRY"
    | "EXIT"
    | "ERROR"
    | "INVALID_SIGNAL"
    | "COOLDOWN_BLOCK";
  timestamp: number;
  price?: number;
  message?: string;
};

function formatTime(tsSeconds: number) {
  if (!Number.isFinite(tsSeconds)) return "-";
  return new Date(tsSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function formatTimeMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export default function Home() {
  const { address, isConnected, connect, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TradingBacktestResponse | null>(null);

  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineResult, setEngineResult] =
    useState<EngineTradingResultResponse | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [copierEvents, setCopierEvents] = useState<CopierEventRecord[]>([]);
  const pollStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollResultRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollEventsRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const parseApiError = useCallback((data: unknown, status: number) => {
    if (typeof data === "object" && data && "message" in data) {
      return String((data as { message?: unknown }).message);
    }
    return `请求失败 (${status})`;
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/copier/status`);
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        setEngineError(parseApiError(data, res.status));
        return;
      }
      setEngineError(null);
      setEngineStatus(data as EngineStatus);
    } catch {
      setEngineError("状态请求失败");
    }
  }, [apiBaseUrl, parseApiError]);

  const fetchEngineResult = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/copier/result`);
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        setEngineError(parseApiError(data, res.status));
        return;
      }
      setEngineError(null);
      setEngineResult(data as EngineTradingResultResponse);
    } catch {
      setEngineError("结果请求失败");
    }
  }, [apiBaseUrl, parseApiError]);

  const fetchCopierEvents = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/copier/events`);
      const data = (await res.json()) as { events?: CopierEventRecord[] };
      if (!res.ok) return;
      if (Array.isArray(data.events)) {
        setCopierEvents(data.events);
      }
    } catch {
      /* ignore */
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    return () => {
      if (pollStatusRef.current) clearInterval(pollStatusRef.current);
      if (pollResultRef.current) clearInterval(pollResultRef.current);
      if (pollEventsRef.current) clearInterval(pollEventsRef.current);
    };
  }, []);

  useEffect(() => {
    if (pollStatusRef.current) {
      clearInterval(pollStatusRef.current);
      pollStatusRef.current = null;
    }
    if (engineStatus?.running) {
      void fetchStatus();
      pollStatusRef.current = setInterval(() => void fetchStatus(), 2000);
    }
    return () => {
      if (pollStatusRef.current) clearInterval(pollStatusRef.current);
    };
  }, [engineStatus?.running, fetchStatus]);

  useEffect(() => {
    if (pollEventsRef.current) {
      clearInterval(pollEventsRef.current);
      pollEventsRef.current = null;
    }
    if (engineStatus?.running) {
      void fetchCopierEvents();
      pollEventsRef.current = setInterval(() => void fetchCopierEvents(), 3000);
    }
    return () => {
      if (pollEventsRef.current) clearInterval(pollEventsRef.current);
    };
  }, [engineStatus?.running, fetchCopierEvents]);

  useEffect(() => {
    if (pollResultRef.current) {
      clearInterval(pollResultRef.current);
      pollResultRef.current = null;
    }
    if (engineStatus?.running) {
      void fetchEngineResult();
      pollResultRef.current = setInterval(() => void fetchEngineResult(), 8000);
    }
    return () => {
      if (pollResultRef.current) clearInterval(pollResultRef.current);
    };
  }, [engineStatus?.running, fetchEngineResult]);

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

  async function startEngine() {
    const addr = inputAddress.trim();
    setEngineError(null);
    if (!addr) {
      setEngineError("请输入 address");
      return;
    }
    setEngineBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/copier/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      await fetchStatus();
      await fetchCopierEvents();
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : "启动失败");
    } finally {
      setEngineBusy(false);
    }
  }

  async function sendCopierSignal(type: "BUY" | "SELL") {
    setEngineError(null);
    setEngineBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/copier/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      if (
        typeof data === "object" &&
        data &&
        "ignored" in data &&
        (data as { ignored?: boolean }).ignored
      ) {
        setEngineError("信号未接受（非 IDLE、平仓冷却中或其它保护）；见行为日志");
      }
      await fetchStatus();
      await fetchCopierEvents();
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : "发送信号失败");
    } finally {
      setEngineBusy(false);
    }
  }

  async function stopEngine() {
    setEngineBusy(true);
    setEngineError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/copier/stop`, {
        method: "POST",
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      await fetchStatus();
      await fetchEngineResult();
      await fetchCopierEvents();
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : "停止失败");
    } finally {
      setEngineBusy(false);
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
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-oo-text">
            ChainQuant
          </h1>
          <p className="text-sm text-oo-text-muted">
            Delayed Copy Trading Engine（MVP）
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={connect}
              className="rounded-lg bg-oo-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-oo-primary-hover"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">
          持续运行引擎
        </h2>
        <p className="mb-4 text-xs text-oo-text-muted">
          默认 <span className="text-oo-text-secondary">MANUAL</span>：不跑内部策略，只响应外部{" "}
          <code className="text-oo-text">BUY</code> /{" "}
          <code className="text-oo-text">SELL</code>。信号后进入{" "}
          <code className="text-oo-text">WAITING_ENTRY</code>，下一 tick 用 Dexscreener
          现价开仓；多/空对应 ±1/10000 止损、±2/10000 止盈。非{" "}
          <code className="text-oo-text">IDLE</code> 或平仓后冷却 tick 未满时信号会被拒绝并记日志。
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void sendCopierSignal("BUY")}
            disabled={
              engineBusy ||
              !engineStatus?.running ||
              engineStatus.state !== "IDLE" ||
              (engineStatus.cooldownTicksRemaining ?? 0) > 0
            }
            className="rounded-lg bg-oo-success px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => void sendCopierSignal("SELL")}
            disabled={
              engineBusy ||
              !engineStatus?.running ||
              engineStatus.state !== "IDLE" ||
              (engineStatus.cooldownTicksRemaining ?? 0) > 0
            }
            className="rounded-lg bg-oo-error px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            SELL
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startEngine}
            disabled={engineBusy || engineStatus?.running}
            className="rounded-lg bg-oo-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-oo-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start Engine
          </button>
          <button
            type="button"
            onClick={stopEngine}
            disabled={engineBusy || !engineStatus?.running}
            className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop Engine
          </button>
          <button
            type="button"
            onClick={() => void fetchStatus()}
            className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            Refresh Status
          </button>
          <button
            type="button"
            onClick={() => void fetchEngineResult()}
            className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            Refresh Result
          </button>
        </div>
        {engineError && (
          <p className="mt-3 text-sm text-oo-error">{engineError}</p>
        )}
        {engineStatus && (
          <dl className="mt-4 grid gap-2 text-sm text-oo-text-secondary md:grid-cols-2">
            <div className="md:col-span-2">
              <dt className="text-xs text-oo-text-muted">address</dt>
              <dd className="break-all font-mono text-xs text-oo-text">
                {engineStatus.address ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">running</dt>
              <dd className="font-mono text-oo-text">{String(engineStatus.running)}</dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">mode</dt>
              <dd className="font-mono text-oo-text">{engineStatus.mode}</dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">state</dt>
              <dd className="font-mono text-oo-text">{engineStatus.state}</dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">pendingSignal</dt>
              <dd className="font-mono text-oo-text">
                {engineStatus.pendingSignalType ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">tickCount</dt>
              <dd className="font-mono text-oo-text">{engineStatus.tickCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">lastExitTick</dt>
              <dd className="font-mono text-oo-text">
                {engineStatus.lastExitTick ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">cooldown</dt>
              <dd className="font-mono text-oo-text">
                {engineStatus.cooldownCandles ?? "—"} ticks · 剩余{" "}
                {engineStatus.cooldownTicksRemaining ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">lastUpdateTime</dt>
              <dd className="font-mono text-xs text-oo-text">
                {formatTimeMs(engineStatus.lastUpdateTime)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">currentPrice</dt>
              <dd className="font-mono text-oo-text">
                {engineStatus.currentPrice != null
                  ? engineStatus.currentPrice.toFixed(4)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-oo-text-muted">entryPrice（持仓开仓价）</dt>
              <dd className="font-mono text-oo-text">
                {engineStatus.entryPrice != null
                  ? engineStatus.entryPrice.toFixed(4)
                  : "—"}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-oo-text-muted">position（持仓中）</dt>
              <dd className="font-mono text-xs break-all text-oo-text">
                {engineStatus.position
                  ? JSON.stringify(engineStatus.position, null, 0)
                  : "null"}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-oo-text">
            行为日志（/copier/events，最近 20 条）
          </h2>
          <button
            type="button"
            onClick={() => void fetchCopierEvents()}
            className="rounded-lg border border-oo-border-strong px-3 py-1.5 text-xs text-oo-text-secondary transition hover:bg-oo-surface-hover"
          >
            刷新日志
          </button>
        </div>
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
              {copierEvents.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={4}>
                    暂无事件；启动引擎后会轮询拉取，或点击「刷新日志」。
                  </td>
                </tr>
              ) : (
                [...copierEvents].reverse().map((ev, idx) => (
                  <tr key={`${ev.id}-${ev.timestamp}-${idx}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-oo-text">
                      {formatTimeMs(ev.timestamp)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span
                        className={
                          ev.type === "ERROR" &&
                          ev.message === "Engine stop requested"
                            ? "text-oo-text-secondary"
                            : ev.type === "ERROR"
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
                      {ev.price != null && Number.isFinite(ev.price)
                        ? ev.price.toFixed(4)
                        : "—"}
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

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">
          引擎交易结果（/copier/result）
        </h2>
        {engineResult ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-oo-text-muted">Total PnL</p>
                <p className="font-mono text-lg text-oo-text">
                  {engineResult.stats.totalPnL.toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-xs text-oo-text-muted">Win Rate</p>
                <p className="font-mono text-lg text-oo-text">
                  {(engineResult.stats.winRate * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-oo-text-muted">Total Trades</p>
                <p className="font-mono text-lg text-oo-text">
                  {engineResult.stats.totalTrades}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-oo-border">
              <table className="min-w-full text-left text-sm text-oo-text-secondary">
                <thead className="bg-oo-bg text-xs text-oo-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium text-oo-text-secondary">
                      Side
                    </th>
                    <th className="px-3 py-2 font-medium text-oo-text-secondary">
                      Entry
                    </th>
                    <th className="px-3 py-2 font-medium text-oo-text-secondary">
                      Exit
                    </th>
                    <th className="px-3 py-2 font-medium text-oo-text-secondary">
                      PnL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oo-border bg-oo-surface">
                  {engineResult.trades.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-mono text-xs text-oo-text">
                        {t.side}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-oo-text">
                        {formatTime(t.entryTime)} / {t.entryPrice.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-oo-text">
                        {formatTime(t.exitTime)} / {t.exitPrice.toFixed(2)}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono ${
                          t.pnl >= 0 ? "text-oo-success" : "text-oo-error"
                        }`}
                      >
                        {t.pnl.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-oo-text-muted">
            尚未加载；点击 Refresh Result 或启动引擎后自动拉取。
          </p>
        )}
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">
          一次性回测（/copier/run）
        </h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-sm font-medium text-oo-text-secondary">
              Address
            </label>
            <input
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 font-mono text-sm text-oo-text outline-none placeholder:text-oo-text-muted focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            />
            {address && (
              <p className="text-xs text-oo-text-muted">
                已连接钱包：
                <span className="font-mono text-oo-text-secondary">{address}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={runStrategy}
            disabled={loading}
            className="rounded-lg bg-oo-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-oo-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Running..." : "Run Strategy"}
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-oo-error">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="grid gap-6">
          <div className="grid gap-3 rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-oo-text-muted">Total PnL</p>
              <p className="font-mono text-lg text-oo-text">
                {result.stats.totalPnL.toFixed(4)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-oo-text-muted">Win Rate</p>
              <p className="font-mono text-lg text-oo-text">
                {(result.stats.winRate * 100).toFixed(2)}%
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-oo-text-muted">Total Trades</p>
              <p className="font-mono text-lg text-oo-text">
                {result.stats.totalTrades}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-oo-border bg-oo-surface shadow-sm">
            <div className="border-b border-oo-border px-5 py-3">
              <h2 className="text-sm font-medium text-oo-text">Trades</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-oo-bg text-xs text-oo-text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Entry Time</th>
                    <th className="px-5 py-3 font-medium">Entry Price</th>
                    <th className="px-5 py-3 font-medium">Exit Time</th>
                    <th className="px-5 py-3 font-medium">Exit Price</th>
                    <th className="px-5 py-3 font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oo-border">
                  {result.trades.map((t, idx) => (
                    <tr key={idx} className="text-oo-text-secondary">
                      <td className="px-5 py-3 font-mono text-xs text-oo-text">
                        {formatTime(t.entryTime)}
                      </td>
                      <td className="px-5 py-3 font-mono text-oo-text">
                        {t.entryPrice.toFixed(4)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-oo-text">
                        {formatTime(t.exitTime)}
                      </td>
                      <td className="px-5 py-3 font-mono text-oo-text">
                        {t.exitPrice.toFixed(4)}
                      </td>
                      <td
                        className={`px-5 py-3 font-mono ${
                          t.profit >= 0 ? "text-oo-success" : "text-oo-error"
                        }`}
                      >
                        {t.profit.toFixed(4)}
                      </td>
                    </tr>
                  ))}

                  {!result.trades.length && (
                    <tr>
                      <td className="px-5 py-6 text-sm text-oo-text-muted" colSpan={5}>
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
