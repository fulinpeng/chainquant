import { tradeQuery, type PnLSummary, type TradeListItem } from "./trade.query";

export type DashboardView = {
  balance: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  recentTrades: TradeListItem[];
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
};

export type { PnLSummary, TradeListItem };
