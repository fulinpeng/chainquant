import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";
import type { ChainKey } from "../config/chains";
import * as fs from "node:fs";
import * as path from "node:path";
import { createEntityId } from "../domain/id";
import type { EngineRuntimeConfig } from "../engine/types";
import { DEFAULT_ENGINE_RUNTIME_CONFIG } from "../engine/types";

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
  private readonly storagePath = path.join(process.cwd(), "watchers.json");
  private watcherList: Watcher[] = [];

  constructor(private readonly listenerService: ListenerService) {}

  onModuleInit() {
    this.loadFromDisk();
    // Restore running watchers into listener watched set.
    for (const watcher of this.watcherList) {
      if (watcher.status === "RUNNING") {
        this.listenerService.upsertWatcher(watcher);
      }
    }
  }

  add(address: string, chain: ChainKey = "arb"): Watcher {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const exists = this.watcherList.some(
      (w) => w.address === normalized && w.chain === chain,
    );
    if (exists) throw new BadRequestException("watcher already exists");

    const watcher: Watcher = {
      id: createEntityId(),
      address: normalized,
      chain,
      status: "STOPPED",
      config: { ...DEFAULT_ENGINE_RUNTIME_CONFIG },
      createdAt: Date.now(),
    };
    this.watcherList.push(watcher);
    this.saveToDisk();
    return watcher;
  }

  list(): Watcher[] {
    return [...this.watcherList].sort((a, b) => b.createdAt - a.createdAt);
  }

  start(address: string, chain: ChainKey = "arb"): Watcher {
    const watcher = this.getOrThrow(address, chain);
    watcher.status = "RUNNING";
    this.listenerService.upsertWatcher(watcher);
    this.saveToDisk();
    return watcher;
  }

  stop(address: string, chain: ChainKey = "arb"): Watcher {
    const watcher = this.getOrThrow(address, chain);
    watcher.status = "STOPPED";
    this.listenerService.removeWatcher(watcher.address, watcher.chain);
    this.saveToDisk();
    return watcher;
  }

  delete(address: string, chain: ChainKey = "arb"): { ok: true } {
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
    this.watcherList.splice(idx, 1);
    this.saveToDisk();
    return { ok: true };
  }

  updateConfig(
    address: string,
    chain: ChainKey = "arb",
    patch: Partial<EngineRuntimeConfig>,
  ): Watcher {
    const watcher = this.getOrThrow(address, chain);
    watcher.config = this.normalizeConfig({
      ...watcher.config,
      ...patch,
    });
    if (watcher.status === "RUNNING") {
      this.listenerService.upsertWatcher(watcher);
    }
    this.saveToDisk();
    return watcher;
  }

  async replayTx(txHash: string, chain?: ChainKey) {
    return this.listenerService.replayTx({ txHash, chain });
  }

  private loadFromDisk() {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, "utf8");
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
        `Failed to load watchers.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private saveToDisk() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.watcherList, null, 2), "utf8");
    } catch (err) {
      this.logger.warn(
        `Failed to save watchers.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  private normalizeConfig(input: Partial<EngineRuntimeConfig>): EngineRuntimeConfig {
    const merged = { ...DEFAULT_ENGINE_RUNTIME_CONFIG, ...input };
    return {
      riskPerTrade: this.numOrDefault(merged.riskPerTrade, DEFAULT_ENGINE_RUNTIME_CONFIG.riskPerTrade),
      stopLossPct: this.numOrDefault(merged.stopLossPct, DEFAULT_ENGINE_RUNTIME_CONFIG.stopLossPct),
      takeProfitPct: this.numOrDefault(merged.takeProfitPct, DEFAULT_ENGINE_RUNTIME_CONFIG.takeProfitPct),
      delayEntry: Boolean(merged.delayEntry),
      maxPositions: Math.max(1, Math.floor(this.numOrDefault(merged.maxPositions, DEFAULT_ENGINE_RUNTIME_CONFIG.maxPositions))),
    };
  }

  private numOrDefault(value: unknown, dft: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : dft;
  }
}

