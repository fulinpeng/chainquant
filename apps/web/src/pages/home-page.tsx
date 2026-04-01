"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import WalletHeader from "@/components/WalletHeader";
import StatsSummaryCards from "@/components/StatsSummaryCards";
import { useWallet } from "@/hooks/useWallet";

type WatcherItem = {
  id: string;
  address: string;
  chain: "ethereum" | "base" | "op" | "arb" | "bnb";
  status: "RUNNING" | "STOPPED";
  config: {
    accountEquityUsdt?: number;
    positionSizingMode?: "risk_from_stop" | "fixed_equity_percent";
    orderEquityPercent?: number;
    riskPerTrade: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxPositions: number;
    mode: "paper" | "live";
    maxTradeAmount: number;
    slippage: number;
    /** 0 = 不筛选；链上 swap 名义(USD)须 ≥ 此值才跟单 */
    minSignalNotionalUsdt: number;
    /** 立即 / 延时（晚 1 tick）/ 回调（FVG） */
    entryMode?: "immediate" | "delayed" | "pullback";
    entryTimeoutMs?: number;
    /** 旧存盘；已并入 entryMode */
    fvgEnabled?: boolean;
    delayEntry?: boolean;
    trailingStopMode?: "off" | "atr";
    trailingStopAtrMultiple?: number;
    trailingStopAtrPeriod?: number;
  };
  createdAt: number;
};

type EngineListItem = {
  address: string;
  token: string;
};

type GlobalStats = {
  address: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
};

function maskAddress(address: string) {
  if (!address) return "--";
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function fmtTime(ts: number) {
  if (!Number.isFinite(ts)) return "--";
  return new Date(ts).toLocaleString();
}

export default function Home() {
  const router = useRouter();
  const { address: walletAddress } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputChain, setInputChain] = useState<WatcherItem["chain"]>("arb");
  const [error, setError] = useState<string | null>(null);
  const [watcherList, setWatcherList] = useState<WatcherItem[]>([]);
  const [engineList, setEngineList] = useState<EngineListItem[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [editing, setEditing] = useState<WatcherItem | null>(null);
  const [editConfig, setEditConfig] = useState({
    accountEquityUsdt: "",
    positionSizingMode: "risk_from_stop" as
      | "risk_from_stop"
      | "fixed_equity_percent",
    orderEquityPercent: "",
    riskPerTrade: "",
    stopLossPct: "",
    takeProfitPct: "",
    maxPositions: "",
    mode: "paper" as "paper" | "live",
    maxTradeAmount: "",
    slippage: "",
    minSignalNotionalUsdt: "",
    entryMode: "pullback" as "immediate" | "delayed" | "pullback",
    entryTimeoutMinutes: "",
    trailingStopMode: "off" as "off" | "atr",
    trailingStopAtrMultiple: "",
    trailingStopAtrPeriod: "",
  });
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

  const fetchWatcherList = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/list`);
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        setError(parseApiError(data, res.status));
        return;
      }
      setError(null);
      setWatcherList(Array.isArray(data) ? (data as WatcherItem[]) : []);
    } catch {
      setError("请求失败（watcher/list）");
    }
  }, [apiBaseUrl, parseApiError]);

  const fetchEngineList = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/engine/list`);
      const data = (await res.json()) as unknown;
      if (!res.ok) return;
      setEngineList(Array.isArray(data) ? (data as EngineListItem[]) : []);
    } catch {
      // 首页忽略引擎列表请求失败
    }
  }, [apiBaseUrl]);

  const fetchGlobalStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/stats/global`);
      const data = (await res.json()) as unknown;
      if (!res.ok) return;
      setGlobalStats(data as GlobalStats);
    } catch {
      // 首页忽略全局统计请求失败
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void fetchWatcherList();
    void fetchEngineList();
    void fetchGlobalStats();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetchWatcherList();
      void fetchEngineList();
      void fetchGlobalStats();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchWatcherList, fetchEngineList, fetchGlobalStats]);

  async function addWatcher() {
    const addr = inputAddress.trim();
    const self = (walletAddress ?? "").trim().toLowerCase();
    setError(null);
    if (!addr) {
      setError("请输入 address");
      return;
    }
    if (self && addr.toLowerCase() === self) {
      setError("不能跟单自己的钱包地址");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, chain: inputChain }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      setInputAddress("");
      setInputChain("arb");
      await fetchWatcherList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加 watcher 失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    action: "start" | "stop" | "delete",
    address: string,
    chain: WatcherItem["chain"],
  ) {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chain }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      await fetchWatcherList();
    } catch (e) {
      setError(e instanceof Error ? e.message : `watcher/${action} 失败`);
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      setError("复制地址失败");
    }
  }

  function viewWatcher(w: WatcherItem) {
    if (w.status !== "RUNNING") {
      setError("Watcher 未运行，无法查看详情");
      return;
    }
    const engine = firstEngineByAddress.get(w.address.toLowerCase());
    if (!engine) {
      setError("Watcher 正在运行，但该地址下暂未生成 Engine（等待链上信号或手动触发）");
      return;
    }
    setError(null);
    router.push(`/copier/${encodeURIComponent(w.address)}/${encodeURIComponent(engine.token)}`);
  }

  function viewStats(w: WatcherItem) {
    router.push(`/stats/${encodeURIComponent(w.address)}`);
  }

  function resolveEntryMode(w: WatcherItem): "immediate" | "delayed" | "pullback" {
    const c = w.config;
    if (c.entryMode === "delayed" || c.entryMode === "pullback") {
      return c.entryMode;
    }
    if (c.entryMode === "immediate") {
      return c.delayEntry === true ? "delayed" : "immediate";
    }
    if (c.fvgEnabled === false) {
      return c.delayEntry === true ? "delayed" : "immediate";
    }
    return "pullback";
  }

  function formatSizingBrief(w: WatcherItem): string {
    const eq = w.config.accountEquityUsdt ?? 10_000;
    if (w.config.positionSizingMode === "fixed_equity_percent") {
      const p = (w.config.orderEquityPercent ?? 0.05) * 100;
      return `固定${p.toFixed(1)}%·${eq}`;
    }
    return `以损${w.config.riskPerTrade}·${eq}`;
  }

  function formatEntryColumn(w: WatcherItem): string {
    const m = resolveEntryMode(w);
    let base: string;
    if (m === "immediate") base = "立即";
    else if (m === "delayed") base = "延时";
    else base = `回调 ${Math.max(1, Math.round((w.config.entryTimeoutMs ?? 900_000) / 60_000))}m`;
    if (w.config.trailingStopMode === "atr") {
      const mult = w.config.trailingStopAtrMultiple ?? 3;
      return `${base} ·ATR×${mult}`;
    }
    return base;
  }

  function openEdit(w: WatcherItem) {
    setEditing(w);
    const entryTimeoutMs = w.config.entryTimeoutMs ?? 900_000;
    setEditConfig({
      accountEquityUsdt: String(w.config.accountEquityUsdt ?? 10_000),
      positionSizingMode:
        w.config.positionSizingMode === "fixed_equity_percent"
          ? "fixed_equity_percent"
          : "risk_from_stop",
      orderEquityPercent: String(
        (w.config.orderEquityPercent ?? 0.05) * 100,
      ),
      riskPerTrade: String(w.config.riskPerTrade),
      stopLossPct: String(w.config.stopLossPct),
      takeProfitPct: String(w.config.takeProfitPct),
      maxPositions: String(w.config.maxPositions),
      mode: w.config.mode,
      maxTradeAmount: String(w.config.maxTradeAmount),
      slippage: String(w.config.slippage),
      minSignalNotionalUsdt: String(
        w.config.minSignalNotionalUsdt ?? 0,
      ),
      entryMode: resolveEntryMode(w),
      entryTimeoutMinutes: String(
        Math.max(1, Math.round(entryTimeoutMs / 60_000)),
      ),
      trailingStopMode: w.config.trailingStopMode === "atr" ? "atr" : "off",
      trailingStopAtrMultiple: String(
        w.config.trailingStopAtrMultiple ?? 3,
      ),
      trailingStopAtrPeriod: String(w.config.trailingStopAtrPeriod ?? 14),
    });
  }

  async function saveEditConfig() {
    if (!editing) return;
    const minsRaw = Number(editConfig.entryTimeoutMinutes);
    const entryTimeoutMinutes = Number.isFinite(minsRaw)
      ? Math.max(1, Math.min(1440, Math.floor(minsRaw)))
      : 15;
    const multRaw = Number(editConfig.trailingStopAtrMultiple);
    const periodRaw = Number(editConfig.trailingStopAtrPeriod);
    const trailingStopAtrMultiple = Number.isFinite(multRaw)
      ? Math.max(0.5, Math.min(50, multRaw))
      : 3;
    const trailingStopAtrPeriod = Number.isFinite(periodRaw)
      ? Math.max(2, Math.min(100, Math.floor(periodRaw)))
      : 14;
    const accountEquityUsdt = Math.max(
      0,
      Number(editConfig.accountEquityUsdt) || 0,
    );
    const orderPctRaw = Number(editConfig.orderEquityPercent);
    const orderEquityPercent = Number.isFinite(orderPctRaw)
      ? Math.min(100, Math.max(0.01, orderPctRaw)) / 100
      : 0.05;
    const payload = {
      accountEquityUsdt,
      positionSizingMode: editConfig.positionSizingMode,
      orderEquityPercent,
      riskPerTrade: Number(editConfig.riskPerTrade),
      stopLossPct: Number(editConfig.stopLossPct),
      takeProfitPct: Number(editConfig.takeProfitPct),
      maxPositions: Number(editConfig.maxPositions),
      mode: editConfig.mode,
      maxTradeAmount: Number(editConfig.maxTradeAmount),
      slippage: Number(editConfig.slippage),
      minSignalNotionalUsdt: Number(editConfig.minSignalNotionalUsdt),
      entryMode: editConfig.entryMode,
      entryTimeoutMs: entryTimeoutMinutes * 60_000,
      trailingStopMode: editConfig.trailingStopMode,
      trailingStopAtrMultiple,
      trailingStopAtrPeriod,
    };
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/update-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: editing.address,
          chain: editing.chain,
          config: payload,
        }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      setEditing(null);
      await fetchWatcherList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update-config 失败");
    }
  }

  const firstEngineByAddress = useMemo(() => {
    const map = new Map<string, EngineListItem>();
    for (const e of engineList) {
      const key = (e.address ?? "").toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, e);
    }
    return map;
  }, [engineList]);

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
      <StatsSummaryCards data={globalStats} title="全局统计（全部地址）" />

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">Watcher 管理</h2>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <label className="flex flex-1 flex-col gap-1 text-xs text-oo-text-muted">
            Address
            <input
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 font-mono text-sm text-oo-text outline-none placeholder:text-oo-text-muted focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-oo-text-muted">
            Chain
            <select
              value={inputChain}
              onChange={(e) => setInputChain(e.target.value as WatcherItem["chain"])}
              className="w-full rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text outline-none focus:border-oo-primary focus:ring-1 focus:ring-oo-primary"
            >
              <option value="arb">arb</option>
              <option value="ethereum">ethereum</option>
              <option value="base">base</option>
              <option value="op">op</option>
              <option value="bnb">bnb</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void addWatcher()}
              disabled={busy}
              className="rounded-lg bg-oo-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-oo-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-oo-error">{error}</p>}
      </section>

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-oo-text">Watcher 列表</h2>
          <button
            type="button"
            onClick={() => void fetchWatcherList()}
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
                <th className="px-3 py-2 font-medium">status</th>
                <th className="px-3 py-2 font-medium">仓位/权益</th>
                <th className="px-3 py-2 font-medium">stopLoss</th>
                <th className="px-3 py-2 font-medium">takeProfit</th>
                <th className="px-3 py-2 font-medium">入场</th>
                <th className="px-3 py-2 font-medium">createdAt</th>
                <th className="px-3 py-2 font-medium">action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {watcherList.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={8}>
                    暂无 Watcher；请先添加 address。
                  </td>
                </tr>
              ) : (
                watcherList.map((w) => (
                  <tr key={w.id}>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      <button
                        type="button"
                        onClick={() => void copyAddress(w.address)}
                        className="rounded px-1 py-0.5 transition hover:bg-oo-surface-hover"
                        title={w.address}
                      >
                        {maskAddress(w.address)}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          w.status === "RUNNING"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-oo-surface-hover text-oo-text-muted"
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {formatSizingBrief(w)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {w.config.stopLossPct}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {w.config.takeProfitPct}
                    </td>
                    <td className="px-3 py-2 text-xs text-oo-text-secondary">
                      {formatEntryColumn(w)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {fmtTime(w.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        {w.status === "RUNNING" ? (
                          <button
                            type="button"
                            onClick={() => void runAction("stop", w.address, w.chain)}
                            className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void runAction("start", w.address, w.chain)}
                            className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                          >
                            Start
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void runAction("delete", w.address, w.chain)}
                          className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(w)}
                          className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => viewWatcher(w)}
                          className={`rounded-md border px-3 py-1.5 transition ${
                            w.status === "RUNNING"
                              ? "border-oo-border-strong text-oo-text-secondary hover:bg-oo-surface-hover"
                              : "border-oo-border text-oo-text-muted"
                          }`}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => viewStats(w)}
                          className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                        >
                          Stats
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-2xl backdrop-saturate-150"
          onClick={() => setEditing(null)}
        >
          <div
            className="flex max-h-[80vh] w-full  max-w-3xl flex-col overflow-hidden rounded-2xl border border-oo-border bg-oo-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="shrink-0 border-b border-oo-border px-5 py-4 text-base font-semibold text-oo-text">
              Watcher Config
            </h3>
            <div className="watcher-config-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="grid gap-2">
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>资金总量</span>
                <input
                  value={editConfig.accountEquityUsdt}
                  onChange={(e) =>
                    setEditConfig((s) => ({
                      ...s,
                      accountEquityUsdt: e.target.value,
                    }))
                  }
                  placeholder="USDT 计价权益"
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-start gap-3 text-xs text-oo-text-muted">
                <span className="pt-2">仓位模式</span>
                <div className="flex flex-col gap-2">
                  <select
                    value={editConfig.positionSizingMode}
                    onChange={(e) =>
                      setEditConfig((s) => ({
                        ...s,
                        positionSizingMode: e.target.value as
                          | "risk_from_stop"
                          | "fixed_equity_percent",
                      }))
                    }
                    className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                  >
                    <option value="risk_from_stop">以损订仓（riskPerTrade）</option>
                    <option value="fixed_equity_percent">
                      固定资金比例（单笔占权益 %）
                    </option>
                  </select>
                  {editConfig.positionSizingMode === "risk_from_stop" && (
                    <>
                      <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-oo-text-muted">
                        <span className="whitespace-nowrap">riskPerTrade</span>
                        <input
                          value={editConfig.riskPerTrade}
                          onChange={(e) =>
                            setEditConfig((s) => ({
                              ...s,
                              riskPerTrade: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                        />
                      </label>
                      <span className="text-[11px] leading-snug text-oo-text-muted">
                        单笔最大亏损占权益比例；仓位数量 = (权益 × riskPerTrade) ÷ |入场价 −
                        止损价|，并受「最大持仓量（代币）」上限。
                      </span>
                    </>
                  )}
                  {editConfig.positionSizingMode === "fixed_equity_percent" && (
                    <>
                      <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-oo-text-muted">
                        <span className="whitespace-nowrap">单笔占权益 %</span>
                        <input
                          type="number"
                          min={0.01}
                          max={100}
                          step={0.1}
                          value={editConfig.orderEquityPercent}
                          onChange={(e) =>
                            setEditConfig((s) => ({
                              ...s,
                              orderEquityPercent: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                        />
                      </label>
                      <span className="text-[11px] leading-snug text-oo-text-muted">
                        单笔目标名义 = 权益 × 该百分比，再除以现价得代币数量；同样受「最大持仓量（代币）」上限。
                      </span>
                    </>
                  )}
                </div>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>stopLossPct</span>
                <input
                  value={editConfig.stopLossPct}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, stopLossPct: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>takeProfitPct</span>
                <input
                  value={editConfig.takeProfitPct}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, takeProfitPct: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>maxPositions</span>
                <input
                  value={editConfig.maxPositions}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, maxPositions: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>mode</span>
                <select
                  value={editConfig.mode}
                  onChange={(e) =>
                    setEditConfig((s) => ({
                      ...s,
                      mode: e.target.value as "paper" | "live",
                    }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                >
                  <option value="paper">paper</option>
                  <option value="live">live</option>
                </select>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-start gap-3 text-xs text-oo-text-muted">
                <span className="pt-2">入场模式</span>
                <div className="flex flex-col gap-2">
                  <select
                    value={editConfig.entryMode}
                    onChange={(e) =>
                      setEditConfig((s) => ({
                        ...s,
                        entryMode: e.target.value as
                          | "immediate"
                          | "delayed"
                          | "pullback",
                      }))
                    }
                    className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                  >
                    <option value="immediate">立即入场</option>
                    <option value="delayed">延时入场</option>
                    <option value="pullback">回调入场（FVG 回踩）</option>
                  </select>
                  {editConfig.entryMode === "delayed" && (
                    <span className="text-[11px] leading-snug text-oo-text-muted">
                      验证通过后走非 FVG 链路；执行就绪后至少再等 1 个引擎 tick 再按市价记开仓。
                    </span>
                  )}
                  {editConfig.entryMode === "pullback" && (
                    <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-oo-text-muted">
                      <span className="whitespace-nowrap">挂单超时（分钟）</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={editConfig.entryTimeoutMinutes}
                        onChange={(e) =>
                          setEditConfig((s) => ({
                            ...s,
                            entryTimeoutMinutes: e.target.value,
                          }))
                        }
                        className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                      />
                    </label>
                  )}
                  {editConfig.entryMode === "pullback" && (
                    <span className="text-[11px] leading-snug text-oo-text-muted">
                      验证通过后做 FVG 校验，在区间内等待价格触达再下单；超时未触价则放弃本次并释放预占资金。范围
                      1–1440 分钟。
                    </span>
                  )}
                </div>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-start gap-3 text-xs text-oo-text-muted">
                <span className="pt-2">移动止损</span>
                <div className="flex flex-col gap-2">
                  <select
                    value={editConfig.trailingStopMode}
                    onChange={(e) =>
                      setEditConfig((s) => ({
                        ...s,
                        trailingStopMode: e.target.value as "off" | "atr",
                      }))
                    }
                    className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                  >
                    <option value="off">关闭</option>
                    <option value="atr">ATR 移动止损</option>
                  </select>
                  {editConfig.trailingStopMode === "atr" && (
                    <>
                      <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-oo-text-muted">
                        <span className="whitespace-nowrap">ATR 倍数</span>
                        <input
                          type="number"
                          min={0.5}
                          max={50}
                          step={0.5}
                          value={editConfig.trailingStopAtrMultiple}
                          onChange={(e) =>
                            setEditConfig((s) => ({
                              ...s,
                              trailingStopAtrMultiple: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                        />
                      </label>
                      <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-oo-text-muted">
                        <span className="whitespace-nowrap">ATR 周期（根）</span>
                        <input
                          type="number"
                          min={2}
                          max={100}
                          value={editConfig.trailingStopAtrPeriod}
                          onChange={(e) =>
                            setEditConfig((s) => ({
                              ...s,
                              trailingStopAtrPeriod: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                        />
                      </label>
                      <span className="text-[11px] leading-snug text-oo-text-muted">
                        按 Dexscreener 池 K 线计算 ATR（与回测里简化 ATR 一致：近 N 根 (high−low)
                        均值）。多单：止损 = max(原止损, 现价 − ATR×倍数)；空单：止损 = min(原止损, 现价 +
                        ATR×倍数)。
                      </span>
                    </>
                  )}
                </div>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-start gap-3 text-xs text-oo-text-muted">
                <span className="pt-2">maxTradeAmount</span>
                <div className="flex flex-col gap-1">
                  <input
                    value={editConfig.maxTradeAmount}
                    onChange={(e) =>
                      setEditConfig((s) => ({
                        ...s,
                        maxTradeAmount: e.target.value,
                      }))
                    }
                    className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                  />
                  <span className="text-[11px] leading-snug text-oo-text-muted">
                    单标的最大持仓数量（代币枚数）上限，参与以损/固定比例 sizing。live：BUY
                    时链上实际投入 WETH ≈（该代币仓位名义 ÷ ETH/USD）；SELL 时卖出代币数量即仓位数量。
                  </span>
                </div>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>slippage</span>
                <input
                  value={editConfig.slippage}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, slippage: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-start gap-3 text-xs text-oo-text-muted">
                <span className="pt-2">minNotional</span>
                <div className="flex flex-col gap-1">
                  <input
                    value={editConfig.minSignalNotionalUsdt}
                    onChange={(e) =>
                      setEditConfig((s) => ({
                        ...s,
                        minSignalNotionalUsdt: e.target.value,
                      }))
                    }
                    placeholder="0"
                    className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                  />
                  <span className="text-[11px] leading-snug text-oo-text-muted">
                    信号最小成交额（USDT/USD 计价）。仅当链上解析到的该笔 swap 名义不低于此值时才跟单；填 0
                    表示不限制。
                  </span>
                </div>
              </label>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-oo-border bg-oo-surface px-5 py-4">
              <button
                type="button"
                onClick={() => void saveEditConfig()}
                className="rounded-lg bg-oo-primary px-4 py-2 text-sm text-white hover:bg-oo-primary-hover"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-oo-border-strong px-4 py-2 text-sm text-oo-text-secondary"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}