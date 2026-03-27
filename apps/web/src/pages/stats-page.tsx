"use client";

import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WalletHeader from "@/components/WalletHeader";
import StatsSummaryCards from "@/components/StatsSummaryCards";

type TradeItem = {
  id: string;
  token: string;
  side: string;
  size: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  status: string;
  txHash: string | null;
  createdAt: string;
};

type DashboardResponse = {
  balance: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  recentTrades: TradeItem[];
};

function shortAddr(address: string) {
  if (!address) return "--";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function fmtNum(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtTime(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString();
}

export default function HomePage() {
  const router = useRouter();
  const routeParams = useParams<{ address?: string }>();
  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    [],
  );
  const activeAddress = decodeURIComponent(routeParams?.address ?? "").trim().toLowerCase();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(
    async (address: string) => {
      const normalized = address.trim().toLowerCase();
      if (!normalized) return;
      setBusy(true);
      try {
        const res = await fetch(`${apiBaseUrl}/stats/${encodeURIComponent(normalized)}`);
        const data = (await res.json()) as DashboardResponse | { message?: string };
        if (!res.ok) {
          setError((data as { message?: string }).message ?? `请求失败 (${res.status})`);
          return;
        }
        setDashboard(data as DashboardResponse);
        setError(null);
      } catch {
        setError("请求 stats 失败");
      } finally {
        setBusy(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    if (!activeAddress) return;
    void fetchDashboard(activeAddress);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      void fetchDashboard(activeAddress);
    }, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeAddress, fetchDashboard]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-oo-bg p-8 text-oo-text">
      <WalletHeader />
      <div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg border border-oo-border-strong px-3 py-1.5 text-xs text-oo-text-secondary transition hover:bg-oo-surface-hover"
        >
          返回首页
        </button>
      </div>

      <StatsSummaryCards
        title=""
        data={
          dashboard
            ? {
                address: activeAddress || "--",
                totalPnl: dashboard.totalPnl,
                winRate: dashboard.winRate,
                openPositions: dashboard.openPositions,
              }
            : {
                address: activeAddress || "--",
                totalPnl: Number.NaN,
                winRate: Number.NaN,
                openPositions: 0,
              }
        }
      />
      {error && <p className="text-sm text-oo-error">{error}</p>}

      <section className="rounded-xl border border-oo-border bg-oo-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-oo-text">最近交易</h2>
          <button
            type="button"
            onClick={() => void fetchDashboard(activeAddress)}
            disabled={!activeAddress || busy}
            className="rounded-lg border border-oo-border-strong px-3 py-1.5 text-xs text-oo-text-secondary transition hover:bg-oo-surface-hover disabled:opacity-50"
          >
            刷新
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-oo-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-oo-bg text-xs text-oo-text-muted">
              <tr>
                <th className="px-3 py-2">token</th>
                <th className="px-3 py-2">side</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">entry</th>
                <th className="px-3 py-2">exit</th>
                <th className="px-3 py-2">pnl</th>
                <th className="px-3 py-2">time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oo-border text-oo-text-secondary">
              {!dashboard || dashboard.recentTrades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-oo-text-muted">
                    暂无交易数据
                  </td>
                </tr>
              ) : (
                dashboard.recentTrades.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-xs text-oo-text">{shortAddr(t.token)}</td>
                    <td className="px-3 py-2 text-xs">{t.side}</td>
                    <td className="px-3 py-2 text-xs">{t.status}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtNum(t.entryPrice)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.exitPrice == null ? "--" : fmtNum(t.exitPrice)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.pnl == null ? "--" : fmtNum(t.pnl)}</td>
                    <td className="px-3 py-2 text-xs">{fmtTime(t.createdAt)}</td>
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
