import type { Trade } from "@prisma/client";
import { prisma } from "../client";

export type TradeRow = Trade;

export type CreateTradeInput = {
  id?: string;
  address: string;
  token: string;
  side: string;
  size: number;
  entryPrice: number;
  exitPrice?: number | null;
  pnl?: number | null;
  status: string;
  txHash?: string | null;
  watcherId: string;
};

export const tradeRepo = {
  async create(data: CreateTradeInput) {
    return prisma.trade.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        address: data.address.toLowerCase(),
        token: data.token.toLowerCase(),
        side: data.side,
        size: data.size,
        entryPrice: data.entryPrice,
        exitPrice: data.exitPrice ?? null,
        pnl: data.pnl ?? null,
        status: data.status,
        txHash: data.txHash ?? null,
        watcher: { connect: { id: data.watcherId } },
      },
    });
  },

  async findByWatcher(watcherId: string) {
    return prisma.trade.findMany({
      where: { watcherId },
      orderBy: { createdAt: "desc" },
    });
  },

  async findByAddressAndToken(address: string, token: string) {
    return prisma.trade.findMany({
      where: {
        address: address.toLowerCase(),
        token: token.toLowerCase(),
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async updateById(
    id: string,
    patch: Partial<Pick<TradeRow, "exitPrice" | "pnl" | "status" | "txHash">>,
  ) {
    return prisma.trade.update({
      where: { id },
      data: patch,
    });
  },
};
