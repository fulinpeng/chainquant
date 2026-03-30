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
    riskPerTrade: number;
    stopLossPct: number;
    takeProfitPct: number;
    delayEntry: boolean;
    maxPositions: number;
    mode: "paper" | "live";
    maxTradeAmount: number;
    slippage: number;
    /** 0 = 不筛选；链上 swap 名义(USD)须 ≥ 此值才跟单 */
    minSignalNotionalUsdt: number;
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
    riskPerTrade: "",
    stopLossPct: "",
    takeProfitPct: "",
    delayEntry: false,
    maxPositions: "",
    mode: "paper" as "paper" | "live",
    maxTradeAmount: "",
    slippage: "",
    minSignalNotionalUsdt: "",
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
      // ignore for watcher page
    }
  }, [apiBaseUrl]);

  const fetchGlobalStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/stats/global`);
      const data = (await res.json()) as unknown;
      if (!res.ok) return;
      setGlobalStats(data as GlobalStats);
    } catch {
      // ignore on home page
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

  function openEdit(w: WatcherItem) {
    setEditing(w);
    setEditConfig({
      riskPerTrade: String(w.config.riskPerTrade),
      stopLossPct: String(w.config.stopLossPct),
      takeProfitPct: String(w.config.takeProfitPct),
      delayEntry: Boolean(w.config.delayEntry),
      maxPositions: String(w.config.maxPositions),
      mode: w.config.mode,
      maxTradeAmount: String(w.config.maxTradeAmount),
      slippage: String(w.config.slippage),
      minSignalNotionalUsdt: String(
        w.config.minSignalNotionalUsdt ?? 0,
      ),
    });
  }

  async function saveEditConfig() {
    if (!editing) return;
    const payload = {
      riskPerTrade: Number(editConfig.riskPerTrade),
      stopLossPct: Number(editConfig.stopLossPct),
      takeProfitPct: Number(editConfig.takeProfitPct),
      delayEntry: Boolean(editConfig.delayEntry),
      maxPositions: Number(editConfig.maxPositions),
      mode: editConfig.mode,
      maxTradeAmount: Number(editConfig.maxTradeAmount),
      slippage: Number(editConfig.slippage),
      minSignalNotionalUsdt: Number(editConfig.minSignalNotionalUsdt),
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
                <th className="px-3 py-2 font-medium">riskPerTrade</th>
                <th className="px-3 py-2 font-medium">stopLoss</th>
                <th className="px-3 py-2 font-medium">takeProfit</th>
                <th className="px-3 py-2 font-medium">createdAt</th>
                <th className="px-3 py-2 font-medium">action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {watcherList.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={7}>
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
                      {w.config.riskPerTrade}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {w.config.stopLossPct}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">
                      {w.config.takeProfitPct}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-oo-border bg-oo-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold text-oo-text">Watcher Config</h3>
            <div className="grid gap-2">
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>riskPerTrade</span>
                <input
                  value={editConfig.riskPerTrade}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, riskPerTrade: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
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
              <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-xs text-oo-text-muted">
                <span>maxTradeAmount</span>
                <input
                  value={editConfig.maxTradeAmount}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, maxTradeAmount: e.target.value }))
                  }
                  className="rounded-lg border border-oo-border-strong bg-oo-bg px-3 py-2 text-sm text-oo-text"
                />
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
              <label className="flex items-center gap-2 text-sm text-oo-text-secondary">
                <input
                  type="checkbox"
                  checked={editConfig.delayEntry}
                  onChange={(e) =>
                    setEditConfig((s) => ({ ...s, delayEntry: e.target.checked }))
                  }
                />
                delayEntry
              </label>
            </div>
            <div className="mt-4 flex items-center gap-2">
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