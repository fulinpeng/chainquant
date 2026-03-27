import type { Watcher } from "@prisma/client";
import { prisma } from "../client";

export type WatcherRow = Watcher;

export const watcherRepo = {
  async findAll(): Promise<WatcherRow[]> {
    return prisma.watcher.findMany({ orderBy: { createdAt: "desc" } });
  },

  async findByAddressAndChain(address: string, chain: string): Promise<WatcherRow | null> {
    return prisma.watcher.findFirst({
      where: {
        address: address.toLowerCase(),
        chain,
      },
    });
  },

  async findById(id: string): Promise<WatcherRow | null> {
    return prisma.watcher.findUnique({ where: { id } });
  },

  async create(data: Pick<WatcherRow, "address" | "chain" | "status">): Promise<WatcherRow> {
    return prisma.watcher.create({
      data: {
        address: data.address.toLowerCase(),
        chain: data.chain,
        status: data.status,
      },
    });
  },

  async upsertById(row: Pick<WatcherRow, "id" | "address" | "chain" | "status">): Promise<WatcherRow> {
    return prisma.watcher.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        address: row.address.toLowerCase(),
        chain: row.chain,
        status: row.status,
      },
      update: {
        address: row.address.toLowerCase(),
        chain: row.chain,
        status: row.status,
      },
    });
  },

  async updateStatus(id: string, status: string): Promise<WatcherRow> {
    return prisma.watcher.update({
      where: { id },
      data: { status },
    });
  },

  async deleteById(id: string): Promise<void> {
    await prisma.watcher.delete({ where: { id } });
  },
};
