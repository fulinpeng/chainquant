import { prisma } from "../client";

export type WatcherRow = {
  id: string;
  address: string;
  chain: string;
  status: string;
  config: string;
  createdAt: Date;
};

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

  async upsert(row: WatcherRow): Promise<WatcherRow> {
    return prisma.watcher.upsert({
      where: { id: row.id },
      create: row,
      update: {
        address: row.address,
        chain: row.chain,
        status: row.status,
        config: row.config,
        createdAt: row.createdAt,
      },
    });
  },

  async deleteById(id: string): Promise<void> {
    await prisma.watcher.delete({ where: { id } });
  },
};
