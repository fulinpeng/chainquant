import type { Prisma, Watcher } from "@prisma/client";
import { prisma } from "../client";

export type CreateWatcherData = {
  id?: string;
  address: string;
  chain: string;
  status: string;
  config: Prisma.InputJsonValue;
};

export type UpdateWatcherData = {
  status?: string;
  config?: Prisma.InputJsonValue;
};

export const watcherRepo = {
  async createWatcher(data: CreateWatcherData): Promise<Watcher> {
    return prisma.watcher.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        address: data.address.toLowerCase(),
        chain: data.chain,
        status: data.status,
        config: data.config,
      },
    });
  },

  async findByAddressAndChain(address: string, chain: string): Promise<Watcher | null> {
    return prisma.watcher.findFirst({
      where: {
        address: address.toLowerCase(),
        chain,
      },
    });
  },

  async listWatchers(): Promise<Watcher[]> {
    return prisma.watcher.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  async updateWatcher(id: string, data: UpdateWatcherData): Promise<Watcher> {
    return prisma.watcher.update({
      where: { id },
      data,
    });
  },

  async updateWatcherStatus(id: string, status: string): Promise<Watcher> {
    return prisma.watcher.update({
      where: { id },
      data: { status },
    });
  },

  async deleteWatcher(id: string): Promise<void> {
    await prisma.watcher.delete({ where: { id } });
  },
};
