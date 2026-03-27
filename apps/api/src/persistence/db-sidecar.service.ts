import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { eventRepo, tradeRepo, watcherRepo } from "@chainquant/db";

const DEFAULT_CHAIN = "arb";

/** 旁路持久化（引擎/执行）：失败只打日志，不向调用方抛错。 */
@Injectable()
export class DbSidecarService {
  private readonly logger = new Logger(DbSidecarService.name);

  private logWriteFail(
    op: string,
    err: unknown,
    ctx: Record<string, string | undefined>,
  ): void {
    const msg = err instanceof Error ? err.message : String(err);
    const ctxStr = Object.entries(ctx)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    this.logger.warn(`[DB_WRITE_FAIL] ${op} ${ctxStr} error=${msg}`);
  }

  async resolveWatcherId(address: string, chain: string = DEFAULT_CHAIN): Promise<string | null> {
    try {
      const rows = await watcherRepo.listWatchers();
      const a = address.trim().toLowerCase();
      const hit = rows.find((w) => w.address === a && w.chain === chain);
      return hit?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[DB_WRITE_FAIL] resolveWatcherId address=${address} chain=${chain} error=${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async recordTradeOpen(input: {
    tradeId: string;
    address: string;
    token: string;
    side: "LONG" | "SHORT";
    size: number;
    entryPrice: number;
    chain?: string;
    txHash?: string | null;
  }): Promise<void> {
    try {
      const chain = input.chain ?? DEFAULT_CHAIN;
      const watcherId = await this.resolveWatcherId(input.address, chain);
      if (!watcherId) {
        this.logger.debug(
          `[db] createTrade skipped (no watcher row): address=${input.address} chain=${chain}`,
        );
        return;
      }
      const side = input.side === "LONG" ? "BUY" : "SELL";
      await tradeRepo.createTrade({
        id: input.tradeId,
        address: input.address,
        token: input.token,
        side,
        size: input.size,
        entryPrice: input.entryPrice,
        txHash: input.txHash ?? null,
        watcherId,
      });
      this.logger.debug(
        `[db] trade OPEN id=${input.tradeId} watcherId=${watcherId} side=${side}`,
      );
    } catch (err) {
      this.logWriteFail("createTrade", err, {
        address: input.address,
        txHash: input.txHash ?? undefined,
      });
    }
  }

  async recordTradeClose(input: {
    tradeId: string;
    exitPrice: number;
    pnl: number;
    address?: string;
    txHash?: string | null;
  }): Promise<void> {
    try {
      await tradeRepo.closeTrade(input.tradeId, input.exitPrice, input.pnl);
      this.logger.debug(
        `[db] trade CLOSED id=${input.tradeId} exit=${input.exitPrice} pnl=${input.pnl}`,
      );
    } catch (err) {
      this.logWriteFail("closeTrade", err, {
        address: input.address,
        txHash: input.txHash ?? undefined,
      });
    }
  }

  async recordExecutionEvent(input: {
    address: string;
    chain?: string;
    ok: boolean;
    mode: "paper" | "live";
    reason?: string;
    txHash?: string;
    data?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const chain = input.chain ?? DEFAULT_CHAIN;
      const watcherId = await this.resolveWatcherId(input.address, chain);
      const type = input.ok ? "EXECUTION" : "ERROR";
      const message = input.ok
        ? input.mode === "live" && input.txHash
          ? `Execution ok (live) tx=${input.txHash}`
          : `Execution ok (${input.mode})`
        : `Execution failed: ${input.reason ?? "unknown"}`;
      const stage = input.ok ? undefined : this.inferStage(input.reason);
      await eventRepo.createEvent({
        type,
        message,
        data:
          input.data !== undefined && input.data !== null
            ? (input.data as Prisma.InputJsonValue)
            : undefined,
        txHash: input.txHash ?? null,
        stage: stage ?? null,
        watcherId,
      });
      this.logger.debug(
        `[db] event ${type} watcherId=${watcherId ?? "none"} ok=${input.ok}`,
      );
    } catch (err) {
      this.logWriteFail("createEvent", err, {
        address: input.address,
        txHash: input.txHash,
      });
    }
  }

  private inferStage(reason?: string): string | undefined {
    if (!reason) return undefined;
    if (reason.includes("quote_failed")) return "quote_failed";
    if (reason.includes("send_tx_failed")) return "send_tx_failed";
    if (reason.includes("approve_failed")) return "approve_failed";
    if (reason.includes("trade_in_flight")) return "trade_in_flight";
    if (reason.includes("timeout")) return "timeout";
    return undefined;
  }
}
