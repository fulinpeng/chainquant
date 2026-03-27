import type { Watcher } from "@prisma/client";
import { prisma } from "../client";

export type CreateWatcherData = {
  /** 与业务侧 watcher id 对齐时传入；否则由数据库生成 cuid。 */
  id?: string;
  address: string;
  chain: string;
  status: string;
};

export const watcherRepo = {
  async createWatcher(data: CreateWatcherData): Promise<Watcher> {
    return prisma.watcher.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        address: data.address.toLowerCase(),
        chain: data.chain,
        status: data.status,
      },
    });
  },

  async listWatchers(): Promise<Watcher[]> {
    return prisma.watcher.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  async updateWatcherStatus(id: string, status: string): Promise<Watcher> {
    return prisma.watcher.update({
      where: { id },
      data: { status },
    });
  },
};
