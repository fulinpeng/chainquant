import { prisma } from "../client";

export type EngineEventRow = {
  id: string;
  address?: string | null;
  token?: string | null;
  type: string;
  timestamp: Date;
  price?: number | null;
  message?: string | null;
};

export const eventRepo = {
  async append(row: EngineEventRow) {
    return prisma.engineEvent.create({
      data: {
        id: row.id,
        address: row.address ?? null,
        token: row.token ?? null,
        type: row.type,
        timestamp: row.timestamp,
        price: row.price ?? null,
        message: row.message ?? null,
      },
    });
  },

  async listRecent(address: string | null, token: string | null, limit: number) {
    const take = Math.min(Math.max(1, limit), 500);
    return prisma.engineEvent.findMany({
      where:
        address && token
          ? {
              address: address.toLowerCase(),
              token: token.toLowerCase(),
            }
          : {},
      orderBy: { timestamp: "desc" },
      take,
    });
  },
};
