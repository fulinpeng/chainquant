"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletHeader from "@/components/WalletHeader";

type WatcherItem = {
  address: string;
  status: "RUNNING" | "STOPPED";
  createdAt: number;
};

type EngineListItem = {
  address: string;
  token: string;
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
  const [mounted, setMounted] = useState(false);
  const [inputAddress, setInputAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watcherList, setWatcherList] = useState<WatcherItem[]>([]);
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

  useEffect(() => {
    void fetchWatcherList();
    void fetchEngineList();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetchWatcherList();
      void fetchEngineList();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchWatcherList, fetchEngineList]);

  async function addWatcher() {
    const addr = inputAddress.trim();
    setError(null);
    if (!addr) {
      setError("请输入 address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) throw new Error(parseApiError(data, res.status));
      setInputAddress("");
      await fetchWatcherList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加 watcher 失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "start" | "stop" | "delete", address: string) {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/watcher/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
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

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-oo-text">Watcher 管理（/watcher/add）</h2>
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
          <h2 className="text-sm font-semibold text-oo-text">Watcher 列表（/watcher/list）</h2>
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
                <th className="px-3 py-2 font-medium">createdAt</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {watcherList.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-oo-text-muted" colSpan={4}>
                    暂无 Watcher；请先添加 address。
                  </td>
                </tr>
              ) : (
                watcherList.map((w) => (
                  <tr key={w.address}>
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
                      {fmtTime(w.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        {w.status === "RUNNING" ? (
                          <button
                            type="button"
                            onClick={() => void runAction("stop", w.address)}
                            className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void runAction("start", w.address)}
                            className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                          >
                            Start
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void runAction("delete", w.address)}
                          className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                        >
                          Delete
                        </button>
                        {firstEngineByAddress.get(w.address.toLowerCase()) ? (
                          <Link
                            href={`/engine/${encodeURIComponent(w.address)}/${encodeURIComponent(firstEngineByAddress.get(w.address.toLowerCase())!.token)}`}
                            className="rounded-md border border-oo-border-strong px-3 py-1.5 text-oo-text-secondary transition hover:bg-oo-surface-hover"
                          >
                            View
                          </Link>
                        ) : (
                          <span className="rounded-md border border-oo-border px-3 py-1.5 text-oo-text-muted">
                            View
                          </span>
                        )}
                      </div>
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