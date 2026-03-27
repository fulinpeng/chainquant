import { tradeQuery, type PnLSummary, type TradeListItem } from "./trade.query";

export type DashboardView = {
  balance: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  recentTrades: TradeListItem[];
};

export type DashboardSummary = {
  address: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
};

const PAPER_BASE_BALANCE = 10000;

export const dashboardQuery = {
  async getDashboard(address: string): Promise<DashboardView> {
    const [summary, openPositions, recentTrades] = await Promise.all([
      tradeQuery.getPnLSummary(address),
      tradeQuery.getOpenPositions(address),
      tradeQuery.listTrades(address),
    ]);

    return {
      balance: PAPER_BASE_BALANCE + summary.totalPnl,
      totalPnl: summary.totalPnl,
      winRate: summary.winRate,
      totalTrades: summary.totalTrades,
      openPositions: openPositions.length,
      recentTrades: recentTrades.slice(0, 10),
    };
  },

  async getGlobalSummary(): Promise<DashboardSummary> {
    const [allTrades, closedTrades, openPositions] = await Promise.all([
      tradeQuery.listAllTrades(),
      tradeQuery.listAllClosedTrades(),
      tradeQuery.countOpenPositions(),
    ]);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalTrades = closedTrades.length;
    const winTrades = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    return {
      address: "--",
      totalPnl,
      winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
      totalTrades,
      openPositions,
    };
  },
};

export type { PnLSummary, TradeListItem };
