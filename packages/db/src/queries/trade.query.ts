import { prisma } from "../client";

export type TradeListItem = {
  id: string;
  address: string;
  token: string;
  side: string;
  size: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  status: string;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PnLSummary = {
  totalPnl: number;
  winRate: number;
  totalTrades: number;
};

const tradeSelect = {
  id: true,
  address: true,
  token: true,
  side: true,
  size: true,
  entryPrice: true,
  exitPrice: true,
  pnl: true,
  status: true,
  txHash: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const tradeQuery = {
  async listTrades(address: string): Promise<TradeListItem[]> {
    return prisma.trade.findMany({
      where: { address: address.toLowerCase() },
      select: tradeSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async getOpenPositions(address: string): Promise<TradeListItem[]> {
    return prisma.trade.findMany({
      where: {
        address: address.toLowerCase(),
        status: "OPEN",
      },
      select: tradeSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async getClosedTrades(address: string): Promise<TradeListItem[]> {
    return prisma.trade.findMany({
      where: {
        address: address.toLowerCase(),
        status: "CLOSED",
      },
      select: tradeSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async getPnLSummary(address: string): Promise<PnLSummary> {
    const normalized = address.toLowerCase();
    const [agg, totalTrades, winTrades] = await Promise.all([
      prisma.trade.aggregate({
        where: {
          address: normalized,
          status: "CLOSED",
        },
        _sum: { pnl: true },
      }),
      prisma.trade.count({
        where: {
          address: normalized,
          status: "CLOSED",
        },
      }),
      prisma.trade.count({
        where: {
          address: normalized,
          status: "CLOSED",
          pnl: { gt: 0 },
        },
      }),
    ]);

    return {
      totalPnl: agg._sum.pnl ?? 0,
      winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
      totalTrades,
    };
  },

  async listAllTrades(): Promise<TradeListItem[]> {
    return prisma.trade.findMany({
      select: tradeSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async listAllClosedTrades(): Promise<TradeListItem[]> {
    return prisma.trade.findMany({
      where: { status: "CLOSED" },
      select: tradeSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async countOpenPositions(): Promise<number> {
    return prisma.trade.count({
      where: { status: "OPEN" },
    });
  },
};
