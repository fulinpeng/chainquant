import type { Prisma } from "@prisma/client";
import { prisma } from "../client";

export type EventListItem = {
  id: string;
  type: string;
  message: string;
  data: Prisma.JsonValue | null;
  txHash: string | null;
  stage: string | null;
  createdAt: Date;
  watcherId: string | null;
};

const eventSelect = {
  id: true,
  type: true,
  message: true,
  data: true,
  txHash: true,
  stage: true,
  createdAt: true,
  watcherId: true,
} as const;

export const eventQuery = {
  async listEvents(address: string, limit = 50): Promise<EventListItem[]> {
    const take = Math.min(Math.max(1, limit), 500);
    return prisma.event.findMany({
      where: {
        watcher: { address: address.toLowerCase() },
      },
      select: eventSelect,
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  async listExecutionEvents(address: string): Promise<EventListItem[]> {
    return prisma.event.findMany({
      where: {
        watcher: { address: address.toLowerCase() },
        type: "EXECUTION",
      },
      select: eventSelect,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },
};
