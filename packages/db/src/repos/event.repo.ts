import type { Event as EventRecord } from "@prisma/client";
import { prisma } from "../client";

/** 与 Prisma `Event` 模型一致；避免与 DOM Event 混淆时使用别名。 */
export type EventRow = EventRecord;

export type AppendEventInput = {
  id?: string;
  type: string;
  message: string;
  txHash?: string | null;
  stage?: string | null;
  watcherId?: string | null;
};

export const eventRepo = {
  async append(input: AppendEventInput) {
    return prisma.event.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        type: input.type,
        message: input.message,
        txHash: input.txHash ?? null,
        stage: input.stage ?? null,
        ...(input.watcherId != null && input.watcherId !== ""
          ? { watcher: { connect: { id: input.watcherId } } }
          : {}),
      },
    });
  },

  async listRecent(params: { watcherId?: string | null; limit: number }) {
    const take = Math.min(Math.max(1, params.limit), 500);
    return prisma.event.findMany({
      where:
        params.watcherId != null && params.watcherId !== ""
          ? { watcherId: params.watcherId }
          : {},
      orderBy: { createdAt: "desc" },
      take,
    });
  },
};
