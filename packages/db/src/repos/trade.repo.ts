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
  /**
   * 当 `txHash` 非空且已存在相同 `(txHash, address)` 时返回已有行，不抛错（幂等）。
   */
  async createTrade(data: CreateTradeData): Promise<Trade> {
    const address = data.address.toLowerCase();
    const tx = data.txHash?.trim() || null;
    if (tx) {
      const existing = await prisma.trade.findFirst({
        where: { txHash: tx, address },
      });
      if (existing) {
        return existing;
      }
    }
    return prisma.trade.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        address,
        token: data.token.toLowerCase(),
        side: data.side,
        size: data.size,
        entryPrice: data.entryPrice,
        exitPrice: null,
        pnl: null,
        status: "OPEN",
        txHash: tx,
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
