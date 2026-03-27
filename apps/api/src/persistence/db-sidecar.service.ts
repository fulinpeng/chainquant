import { Injectable, Logger } from "@nestjs/common";
import { eventRepo, tradeRepo, watcherRepo } from "@chainquant/db";

const DEFAULT_CHAIN = "arb";

/** 旁路持久化：失败只打日志，不向调用方抛错。 */
@Injectable()
export class DbSidecarService {
  private readonly logger = new Logger(DbSidecarService.name);

  async recordWatcherCreated(input: {
    id: string;
    address: string;
    chain: string;
    status: string;
  }): Promise<void> {
    try {
      await watcherRepo.createWatcher({
        id: input.id,
        address: input.address,
        chain: input.chain,
        status: input.status,
      });
      this.logger.debug(
        `[db] watcher created id=${input.id} address=${input.address} chain=${input.chain}`,
      );
    } catch (err) {
      this.logger.warn(
        `[db] createWatcher failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async resolveWatcherId(address: string, chain: string = DEFAULT_CHAIN): Promise<string | null> {
    try {
      const rows = await watcherRepo.listWatchers();
      const a = address.trim().toLowerCase();
      const hit = rows.find((w) => w.address === a && w.chain === chain);
      return hit?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[db] resolveWatcherId failed: ${err instanceof Error ? err.message : String(err)}`,
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
        watcherId,
      });
      this.logger.debug(
        `[db] trade OPEN id=${input.tradeId} watcherId=${watcherId} side=${side}`,
      );
    } catch (err) {
      this.logger.warn(
        `[db] createTrade failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async recordTradeClose(input: {
    tradeId: string;
    exitPrice: number;
    pnl: number;
  }): Promise<void> {
    try {
      await tradeRepo.closeTrade(input.tradeId, input.exitPrice, input.pnl);
      this.logger.debug(
        `[db] trade CLOSED id=${input.tradeId} exit=${input.exitPrice} pnl=${input.pnl}`,
      );
    } catch (err) {
      this.logger.warn(
        `[db] closeTrade failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async recordExecutionEvent(input: {
    address: string;
    chain?: string;
    ok: boolean;
    mode: "paper" | "live";
    reason?: string;
    txHash?: string;
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
        txHash: input.txHash ?? null,
        stage: stage ?? null,
        watcherId,
      });
      this.logger.debug(
        `[db] event ${type} watcherId=${watcherId ?? "none"} ok=${input.ok}`,
      );
    } catch (err) {
      this.logger.warn(
        `[db] createEvent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
