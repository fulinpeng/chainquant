import type { Trade } from "@prisma/client";
import { prisma } from "../client";

/** 新建一笔开仓成交（状态固定为 OPEN）。 */
export type CreateTradeData = {
  id?: string;
  address: string;
  token: string;
  side: string;
  size: number;
  entryPrice: number;
  txHash?: string | null;
  watcherId: string;
};

export const tradeRepo = {
  async createTrade(data: CreateTradeData): Promise<Trade> {
    return prisma.trade.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        address: data.address.toLowerCase(),
        token: data.token.toLowerCase(),
        side: data.side,
        size: data.size,
        entryPrice: data.entryPrice,
        exitPrice: null,
        pnl: null,
        status: "OPEN",
        txHash: data.txHash ?? null,
        watcher: { connect: { id: data.watcherId } },
      },
    });
  },

  async closeTrade(id: string, exitPrice: number, pnl: number): Promise<Trade> {
    return prisma.trade.update({
      where: { id },
      data: {
        exitPrice,
        pnl,
        status: "CLOSED",
      },
    });
  },

  async listTradesByAddress(address: string): Promise<Trade[]> {
    return prisma.trade.findMany({
      where: { address: address.toLowerCase() },
      orderBy: { createdAt: "desc" },
    });
  },
};
