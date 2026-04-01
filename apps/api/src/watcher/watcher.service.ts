import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma, Watcher as WatcherRow } from "@prisma/client";
import { watcherRepo } from "@chainquant/db";
import { ListenerService } from "../listener/listener.service";
import type { ChainKey } from "../config/chains";
import * as fs from "node:fs";
import * as path from "node:path";
import { createEntityId } from "../domain/id";
import type { EngineRuntimeConfig } from "../engine/types";
import { coerceEntryMode, DEFAULT_ENGINE_RUNTIME_CONFIG } from "../engine/types";

export type Watcher = {
  id: string;
  address: string;
  chain: ChainKey;
  status: "RUNNING" | "STOPPED";
  config: EngineRuntimeConfig;
  createdAt: number;
};

@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);
  /** 仅作一次性迁移回退读取，不再写入。 */
  private readonly legacyStoragePath = path.join(process.cwd(), "watchers.json");
  private watcherList: Watcher[] = [];

  constructor(private readonly listenerService: ListenerService) {}

  async onModuleInit() {
    await this.loadFromDatabase();
    if (this.watcherList.length === 0) {
      this.loadFromLegacyJsonReadonly();
      await this.seedDatabaseFromMemoryIfNeeded();
    }
    for (const watcher of this.watcherList) {
      if (watcher.status === "RUNNING") {
        this.listenerService.upsertWatcher(watcher);
      }
    }
  }

  async add(address: string, chain: ChainKey = "arb"): Promise<Watcher> {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const exists = this.watcherList.some(
      (w) => w.address === normalized && w.chain === chain,
    );
    if (exists) throw new BadRequestException("watcher already exists");

    const cfg = this.normalizeConfig({ ...DEFAULT_ENGINE_RUNTIME_CONFIG });
    try {
      const row = await watcherRepo.createWatcher({
        id: createEntityId(),
        address: normalized,
        chain,
        status: "STOPPED",
        config: cfg as unknown as Prisma.InputJsonValue,
      });
      const watcher = this.rowToWatcher(row);
      this.watcherList.push(watcher);
      return watcher;
    } catch (err) {
      this.logDbWriteFail("createWatcher", err, { address: normalized });
      throw new ServiceUnavailableException("database unavailable");
    }
  }

  list(): Watcher[] {
    return [...this.watcherList].sort((a, b) => b.createdAt - a.createdAt);
  }

  async start(address: string, chain: ChainKey = "arb"): Promise<Watcher> {
    const watcher = this.getOrThrow(address, chain);
    try {
      const row = await watcherRepo.updateWatcher(watcher.id, { status: "RUNNING" });
      const next = this.rowToWatcher(row);
      this.replaceInList(next);
      this.listenerService.upsertWatcher(next);
      return next;
    } catch (err) {
      this.logDbWriteFail("updateWatcher(start)", err, { address: watcher.address });
      throw new ServiceUnavailableException("database unavailable");
    }
  }

  async stop(address: string, chain: ChainKey = "arb"): Promise<Watcher> {
    const watcher = this.getOrThrow(address, chain);
    try {
      const row = await watcherRepo.updateWatcher(watcher.id, { status: "STOPPED" });
      const next = this.rowToWatcher(row);
      this.replaceInList(next);
      this.listenerService.removeWatcher(next.address, next.chain);
      return next;
    } catch (err) {
      this.logDbWriteFail("updateWatcher(stop)", err, { address: watcher.address });
      throw new ServiceUnavailableException("database unavailable");
    }
  }

  async delete(address: string, chain: ChainKey = "arb"): Promise<{ ok: true }> {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const idx = this.watcherList.findIndex(
      (w) => w.address === normalized && w.chain === chain,
    );
    if (idx < 0) throw new BadRequestException("watcher not found");
    const watcher = this.watcherList[idx];
    if (watcher.status === "RUNNING") {
      this.listenerService.removeWatcher(watcher.address, watcher.chain);
    }
    try {
      await watcherRepo.deleteWatcher(watcher.id);
      this.watcherList.splice(idx, 1);
      return { ok: true };
    } catch (err) {
      this.logDbWriteFail("deleteWatcher", err, { address: watcher.address });
      throw new ServiceUnavailableException("database unavailable");
    }
  }

  async updateConfig(
    address: string,
    chain: ChainKey = "arb",
    patch: Partial<EngineRuntimeConfig>,
  ): Promise<Watcher> {
    const watcher = this.getOrThrow(address, chain);
    const nextConfig = this.normalizeConfig({
      ...watcher.config,
      ...patch,
    });
    try {
      const row = await watcherRepo.updateWatcher(watcher.id, {
        config: nextConfig as unknown as Prisma.InputJsonValue,
      });
      const next = this.rowToWatcher(row);
      this.replaceInList(next);
      if (next.status === "RUNNING") {
        this.listenerService.upsertWatcher(next);
      }
      return next;
    } catch (err) {
      this.logDbWriteFail("updateWatcher(config)", err, { address: watcher.address });
      throw new ServiceUnavailableException("database unavailable");
    }
  }

  async replayTx(txHash: string, chain?: ChainKey) {
    return this.listenerService.replayTx({ txHash, chain });
  }

  private async loadFromDatabase(): Promise<void> {
    try {
      const rows = await watcherRepo.listWatchers();
      this.watcherList = rows.map((r) => this.rowToWatcher(r));
    } catch (err) {
      this.logger.warn(
        `[DB_WRITE_FAIL] listWatchers (read) error=${err instanceof Error ? err.message : String(err)}`,
      );
      this.watcherList = [];
    }
  }

  /** 仅在数据库为空时尝试从 legacy `watchers.json` 读入内存。 */
  private loadFromLegacyJsonReadonly(): void {
    if (!fs.existsSync(this.legacyStoragePath)) return;
    try {
      const raw = fs.readFileSync(this.legacyStoragePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      this.watcherList = parsed
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
        .map((x) => {
          const address =
            typeof x.address === "string" ? x.address.toLowerCase() : "";
          const status: Watcher["status"] =
            x.status === "RUNNING" || x.status === "STOPPED" ? x.status : "STOPPED";
          const createdAt =
            typeof x.createdAt === "number" ? x.createdAt : Date.now();
          const id = typeof x.id === "string" && x.id ? x.id : createEntityId();
          const chain = this.normalizeChain(x.chain);
          const config = this.normalizeConfig(
            (x.config as Partial<EngineRuntimeConfig> | undefined) ?? {},
          );
          return { id, address, chain, status, config, createdAt };
        })
        .filter((x) => x.address);
    } catch (err) {
      this.logger.warn(
        `Legacy watchers.json read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 将内存中来自 JSON 的条目写入数据库并重新加载。 */
  private async seedDatabaseFromMemoryIfNeeded(): Promise<void> {
    if (this.watcherList.length === 0) return;
    for (const w of [...this.watcherList]) {
      try {
        await watcherRepo.createWatcher({
          id: w.id,
          address: w.address,
          chain: w.chain,
          status: w.status,
          config: w.config as unknown as Prisma.InputJsonValue,
        });
      } catch (err) {
        this.logDbWriteFail("seedWatcher", err, { address: w.address });
      }
    }
    await this.loadFromDatabase();
  }

  private replaceInList(next: Watcher): void {
    const i = this.watcherList.findIndex((x) => x.id === next.id);
    if (i >= 0) this.watcherList[i] = next;
  }

  private rowToWatcher(row: WatcherRow): Watcher {
    const raw = row.config as unknown;
    const cfg =
      raw && typeof raw === "object"
        ? this.normalizeConfig(raw as Partial<EngineRuntimeConfig>)
        : this.normalizeConfig({});
    return {
      id: row.id,
      address: row.address,
      chain: this.normalizeChain(row.chain),
      status: row.status === "RUNNING" ? "RUNNING" : "STOPPED",
      config: cfg,
      createdAt: row.createdAt.getTime(),
    };
  }

  private logDbWriteFail(
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

  private getOrThrow(address: string, chain: ChainKey = "arb"): Watcher {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const watcher = this.watcherList.find(
      (w) => w.address === normalized && w.chain === chain,
    );
    if (!watcher) throw new BadRequestException("watcher not found");
    return watcher;
  }

  private normalizeChain(input: unknown): ChainKey {
    if (input === "ethereum" || input === "base" || input === "op" || input === "arb" || input === "bnb") {
      return input;
    }
    return "arb";
  }

  private normalizeConfig(
    input: Partial<EngineRuntimeConfig> & {
      fvgEnabled?: boolean;
      delayEntry?: boolean;
    },
  ): EngineRuntimeConfig {
    const merged = { ...DEFAULT_ENGINE_RUNTIME_CONFIG, ...input };
    const riskPerTrade = this.numOrDefault(
      merged.riskPerTrade,
      DEFAULT_ENGINE_RUNTIME_CONFIG.riskPerTrade,
    );
    const stopLossPct = this.numOrDefault(
      merged.stopLossPct,
      DEFAULT_ENGINE_RUNTIME_CONFIG.stopLossPct,
    );
    const takeProfitPct = this.numOrDefault(
      merged.takeProfitPct,
      DEFAULT_ENGINE_RUNTIME_CONFIG.takeProfitPct,
    );
    const maxTradeAmount = this.numOrDefault(
      merged.maxTradeAmount,
      DEFAULT_ENGINE_RUNTIME_CONFIG.maxTradeAmount,
    );
    const slippage = this.numOrDefault(
      merged.slippage,
      DEFAULT_ENGINE_RUNTIME_CONFIG.slippage,
    );
    const minSignalNotionalUsdt = this.numOrDefault(
      merged.minSignalNotionalUsdt,
      DEFAULT_ENGINE_RUNTIME_CONFIG.minSignalNotionalUsdt,
    );
    const entryTimeoutMsRaw = this.numOrDefault(
      merged.entryTimeoutMs,
      DEFAULT_ENGINE_RUNTIME_CONFIG.entryTimeoutMs,
    );
    const entryTimeoutMs = Math.max(
      60_000,
      Math.min(86_400_000, Math.floor(entryTimeoutMsRaw)),
    );
    const entryMode = coerceEntryMode(input);
    return {
      riskPerTrade: Math.min(1, Math.max(0, riskPerTrade)),
      stopLossPct: Math.max(0, stopLossPct),
      takeProfitPct: Math.max(0, takeProfitPct),
      maxPositions: Math.max(1, Math.floor(this.numOrDefault(merged.maxPositions, DEFAULT_ENGINE_RUNTIME_CONFIG.maxPositions))),
      mode: merged.mode === "live" ? "live" : "paper",
      maxTradeAmount: Math.max(0, maxTradeAmount),
      slippage: Math.min(0.05, Math.max(0.0001, slippage)),
      minSignalNotionalUsdt: Math.max(0, minSignalNotionalUsdt),
      entryTimeoutMs,
      entryMode,
    };
  }

  private numOrDefault(value: unknown, dft: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : dft;
  }
}
