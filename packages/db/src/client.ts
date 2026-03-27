import { PrismaClient } from "@prisma/client";

/**
 * 单例 PrismaClient — 全包仅此一处 `new PrismaClient()`。
 */
export const prisma = new PrismaClient();
