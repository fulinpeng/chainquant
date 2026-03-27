import { prisma } from "../client";

export type TradeRow = {
  id: string;
  address: string;
  token: string;
  side: string;
  entryTime: number;
  entryPrice: number;
  size: number;
  exitTime: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  pnl: number | null;
  status: string;
};

export const tradeRepo = {
  async create(row: TradeRow) {
    return prisma.trade.create({
      data: {
        id: row.id,
        address: row.address,
        token: row.token,
        side: row.side,
        entryTime: row.entryTime,
        entryPrice: row.entryPrice,
        size: row.size,
        exitTime: row.exitTime,
        exitPrice: row.exitPrice,
        stopLoss: row.stopLoss,
        takeProfit: row.takeProfit,
        pnl: row.pnl,
        status: row.status,
      },
    });
  },

  async findByEngine(address: string, token: string) {
    return prisma.trade.findMany({
      where: { address: address.toLowerCase(), token: token.toLowerCase() },
      orderBy: { entryTime: "desc" },
    });
  },

  async updateById(
    id: string,
    patch: Partial<Pick<TradeRow, "exitTime" | "exitPrice" | "pnl" | "status">>,
  ) {
    return prisma.trade.update({
      where: { id },
      data: patch,
    });
  },
};
