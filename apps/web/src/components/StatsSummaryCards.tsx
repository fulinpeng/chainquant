"use client";

type StatsSummary = {
  address: string;
  totalPnl: number;
  winRate: number;
  openPositions: number;
};

function shortAddr(address: string) {
  if (!address || address === "--") return "--";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function fmtNum(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "--";
  return `${(n * 100).toFixed(2)}%`;
}

function signedNumClass(n: number): string {
  if (!Number.isFinite(n) || n == 0) return "text-oo-text";
  return n > 0 ? "text-green-400" : "text-red-400";
}

function winRateClass(n: number): string {
  if (!Number.isFinite(n)) return "text-oo-text";
  if (n > 0.5) return "text-green-400";
  if (n < 0.5) return "text-red-400";
  return "text-oo-text";
}

export default function StatsSummaryCards({
  data,
  title,
}: {
  data: StatsSummary | null;
  title?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      {title ? <h2 className="text-sm font-semibold text-oo-text">{title}</h2> : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="rounded-xl border border-oo-border bg-oo-surface p-4">
        <p className="text-xs text-oo-text-muted">Address</p>
        <p className="mt-2 font-mono text-sm text-oo-text">{shortAddr(data?.address ?? "--")}</p>
      </div>
      <div className="rounded-xl border border-oo-border bg-oo-surface p-4">
        <p className="text-xs text-oo-text-muted">总收益</p>
        <p className={`mt-2 text-lg font-semibold ${signedNumClass(data?.totalPnl ?? Number.NaN)}`}>{fmtNum(data?.totalPnl ?? Number.NaN)}</p>
      </div>
      <div className="rounded-xl border border-oo-border bg-oo-surface p-4">
        <p className="text-xs text-oo-text-muted">胜率</p>
        <p className={`mt-2 text-lg font-semibold ${winRateClass(data?.winRate ?? Number.NaN)}`}>
          {fmtPct(data?.winRate ?? Number.NaN)}
        </p>
      </div>
      <div className="rounded-xl border border-oo-border bg-oo-surface p-4">
        <p className="text-xs text-oo-text-muted">Open Positions</p>
        <p className="mt-2 text-lg font-semibold text-oo-text">{data?.openPositions ?? 0}</p>
      </div>
      </div>
    </section>
  );
}
