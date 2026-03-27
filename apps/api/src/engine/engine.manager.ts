import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { MarketService } from "../market/market.service";
import { ExecutionService } from "../execution/execution.service";
import { TradingEngine } from "./trading-engine";
import type { CopierSignalPayload, EngineRuntimeConfig, OnSignalResult } from "./types";
import { DEFAULT_ENGINE_RUNTIME_CONFIG } from "./types";
import { ENGINE_TICK_MS } from "./types";
import type { EngineStatusDto } from "./types";

@Injectable()
export class EngineManager implements OnModuleDestroy {
  private readonly logger = new Logger(EngineManager.name);
  private readonly engines = new Map<string, TradingEngine>();
  private readonly watchedAddresses = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;

  constructor(
    private readonly marketService: MarketService,
    private readonly executionService: ExecutionService,
  ) {}

  onModuleDestroy() {
    this.clearTickTimer();
  }

  makeKey(address: string, token: string): string {
    return `${address.trim()}_${token.trim()}`;
  }

  getOrCreateEngine(
    address: string,
    token: string,
    config: EngineRuntimeConfig = DEFAULT_ENGINE_RUNTIME_CONFIG,
  ): TradingEngine {
    const a = address.trim();
    const t = token.trim();
    if (!a || !t) {
      throw new BadRequestException("address and token are required");
    }
    const key = this.makeKey(a, t);
    let engine = this.engines.get(key);
    if (!engine) {
      engine = new TradingEngine({
        marketService: this.marketService,
        executionService: this.executionService,
        address: a,
        token: t,
        config,
      });
      this.engines.set(key, engine);
      this.logger.log(`Created engine ${key}`);
    } else {
      engine.updateConfig(config);
    }
    return engine;
  }

  getEngineOrThrow(address: string, token: string): TradingEngine {
    const a = address.trim();
    const t = token.trim();
    if (!a || !t) {
      throw new BadRequestException("address and token are required");
    }
    const key = this.makeKey(a, t);
    const engine = this.engines.get(key);
    if (!engine) {
      throw new BadRequestException(`No engine for ${key}`);
    }
    return engine;
  }

  listEngines(): TradingEngine[] {
    return [...this.engines.values()];
  }

  listEngineSummaries(): Array<{
    address: string;
    token: string;
    state: EngineStatusDto["state"];
    entryPrice?: number;
    currentPrice?: number;
    pnl?: number;
  }> {
    return this.listEngines().map((e) => {
      const status = e.getStatus();
      const result = e.getResult();
      return {
        address: status.address,
        token: status.token,
        state: status.state,
        entryPrice: status.entryPrice ?? undefined,
        currentPrice: status.currentPrice ?? undefined,
        pnl: result.stats.totalPnL,
      };
    });
  }

  getEngineDetail(address: string, token: string): {
    state: EngineStatusDto["state"];
    position: EngineStatusDto["position"];
    trades: ReturnType<TradingEngine["getResult"]>["trades"];
    events: ReturnType<TradingEngine["getRecentEvents"]>;
    currentPrice: number | null;
    entryPrice: number | null;
    pendingSignalType: EngineStatusDto["pendingSignalType"];
    tickCount: number;
    lastUpdateTime: number;
    lastExitTick: number | null;
    cooldownCandles: number;
    cooldownTicksRemaining: number;
    running: EngineStatusDto["running"];
    mode: EngineStatusDto["mode"];
  } {
    const engine = this.getEngineOrThrow(address, token);
    const status = engine.getStatus();
    const result = engine.getResult();
    const events = engine.getRecentEvents(100);
    return {
      state: status.state,
      position: status.position,
      trades: result.trades,
      events,
      currentPrice: status.currentPrice,
      entryPrice: status.entryPrice,
      pendingSignalType: status.pendingSignalType,
      tickCount: status.tickCount,
      lastUpdateTime: status.lastUpdateTime,
      lastExitTick: status.lastExitTick,
      cooldownCandles: status.cooldownCandles,
      cooldownTicksRemaining: status.cooldownTicksRemaining,
      running: status.running,
      mode: status.mode,
    };
  }

  addAddress(address: string): { ok: true } {
    const a = (address ?? "").trim();
    if (!a) throw new BadRequestException("address is required");
    this.watchedAddresses.add(a.toLowerCase());
    return { ok: true };
  }

  removeAddress(address: string): { ok: true } {
    const a = (address ?? "").trim();
    if (!a) throw new BadRequestException("address is required");
    this.watchedAddresses.delete(a.toLowerCase());
    return { ok: true };
  }

  isWatchedAddress(address: string): boolean {
    return this.watchedAddresses.has((address ?? "").trim().toLowerCase());
  }

  /**
   * Route signal to the engine for `address` + `signal.token`.
   * `token` on payload defaults to `address` when omitted (single-key MVP).
   */
  handleSignal(
    address: string,
    signal: CopierSignalPayload & {
      token?: string;
      config?: EngineRuntimeConfig;
      amount?: string;
      chain?: string;
    },
  ): OnSignalResult {
    const a = address.trim();
    const token = (signal.token ?? a).trim();
    if (!a || !token) {
      throw new BadRequestException("address and token are required");
    }
    const engine = this.getOrCreateEngine(
      a,
      token,
      signal.config ?? DEFAULT_ENGINE_RUNTIME_CONFIG,
    );
    if (!engine.isRunning()) {
      engine.start();
      this.notifyEngineStarted();
    }
    return engine.onSignal({
      type: signal.type,
      price: signal.price,
      amount: signal.amount,
      chain: signal.chain,
    });
  }

  /**
   * Minimal testing entry for Engine system.
   * - Auto create/reuse engine by (address, token)
   * - Auto start when not running
   * - Trigger one manual signal (BUY) to drive FSM into WAITING_ENTRY
   */
  handleSignalTest(input: {
    address: string;
    token: string;
    price: number;
  }): OnSignalResult {
    const address = (input.address ?? "").trim();
    const token = (input.token ?? "").trim();
    const price = Number(input.price);
    if (!address || !token) {
      throw new BadRequestException("address and token are required");
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException("price must be a positive number");
    }

    return this.handleSignal(address, {
      type: "BUY",
      token,
      price,
      config: DEFAULT_ENGINE_RUNTIME_CONFIG,
    });
  }

  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      for (const engine of this.engines.values()) {
        if (engine.isRunning()) {
          await engine.onTick();
        }
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  private clearTickTimer() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private refreshTickTimer() {
    const anyRunning = [...this.engines.values()].some((e) => e.isRunning());
    if (anyRunning) {
      if (!this.tickTimer) {
        this.tickTimer = setInterval(() => {
          void this.tick();
        }, ENGINE_TICK_MS);
      }
    } else {
      this.clearTickTimer();
    }
  }

  /** Call after an engine transitions to running. */
  notifyEngineStarted() {
    this.refreshTickTimer();
  }

  /** Call after an engine stops. */
  notifyEngineStopped() {
    this.refreshTickTimer();
  }
}
