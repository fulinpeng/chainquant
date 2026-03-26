import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { MarketService } from "../market/market.service";
import { TradingEngine } from "./trading-engine";
import type { CopierSignalPayload, OnSignalResult } from "./types";
import { ENGINE_TICK_MS } from "./types";

@Injectable()
export class EngineManager implements OnModuleDestroy {
  private readonly logger = new Logger(EngineManager.name);
  private readonly engines = new Map<string, TradingEngine>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;

  constructor(private readonly marketService: MarketService) {}

  onModuleDestroy() {
    this.clearTickTimer();
  }

  makeKey(address: string, token: string): string {
    return `${address.trim()}_${token.trim()}`;
  }

  getOrCreateEngine(address: string, token: string): TradingEngine {
    const a = address.trim();
    const t = token.trim();
    if (!a || !t) {
      throw new BadRequestException("address and token are required");
    }
    const key = this.makeKey(a, t);
    let engine = this.engines.get(key);
    if (!engine) {
      engine = new TradingEngine(this.marketService, a, t);
      this.engines.set(key, engine);
      this.logger.log(`Created engine ${key}`);
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

  /**
   * Route signal to the engine for `address` + `signal.token`.
   * `token` on payload defaults to `address` when omitted (single-key MVP).
   */
  handleSignal(
    address: string,
    signal: CopierSignalPayload & { token?: string },
  ): OnSignalResult {
    const token = (signal.token ?? address).trim();
    const engine = this.getEngineOrThrow(address.trim(), token);
    return engine.onSignal({ type: signal.type });
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
