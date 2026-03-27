import type { Event as EventRecord } from "@prisma/client";
import { prisma } from "../client";

/** 与数据库 `Event` 行一致；命名避免与浏览器 `Event` 混淆。 */
export type { EventRecord };

export type CreateEventData = {
  id?: string;
  type: string;
  message: string;
  txHash?: string | null;
  stage?: string | null;
  watcherId?: string | null;
};

export const eventRepo = {
  async createEvent(data: CreateEventData): Promise<EventRecord> {
    return prisma.event.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        type: data.type,
        message: data.message,
        txHash: data.txHash ?? null,
        stage: data.stage ?? null,
        ...(data.watcherId != null && data.watcherId !== ""
          ? { watcher: { connect: { id: data.watcherId } } }
          : {}),
      },
    });
  },

  /**
   * 按监听地址聚合：通过 `Watcher.address` 关联。
   * 无 `watcherId` 的孤立事件不会出现在结果中。
   */
  async listEventsByAddress(address: string): Promise<EventRecord[]> {
    return prisma.event.findMany({
      where: {
        watcher: { address: address.toLowerCase() },
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
