import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import { createEntityId } from "../domain/id";
import type { Position } from "../domain/position";
import type { Signal as DomainSignal } from "../domain/signal";
import type { Trade } from "../domain/trade";
import { StateStore } from "../state/state-store.service";

export type EngineMode = "MANUAL" | "AUTO";

export type CopierSignalPayload = {
  type: "BUY" | "SELL";
};

export type EngineState = "IDLE" | "WAITING_ENTRY" | "IN_POSITION";

export type EngineStatusDto = {
  running: boolean;
  mode: EngineMode;
  state: EngineState;
  currentPrice: number | null;
  /** IN_POSITION: entry price. */
  entryPrice: number | null;
  /** WAITING_ENTRY: which external signal is pending. */
  pendingSignalType: "BUY" | "SELL" | null;
  position: Position | null;
  tickCount: number;
  lastUpdateTime: number;
  /** Engine loop tick index at last EXIT; null if never exited this session. */
  lastExitTick: number | null;
  /** Configured cooldown length in ticks. */
  cooldownCandles: number;
  /** Ticks remaining before a new signal is allowed; 0 when not cooling down. */
  cooldownTicksRemaining: number;
  address: string | null;
};

export type OnSignalResult = { ok: true } | { ok: true; ignored: true };

export type EngineResultDto = {
  trades: Trade[];
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
  };
};

const TICK_MS = 2000;
const MANUAL_SL_FRACTION = 1 / 10000;
const MANUAL_TP_FRACTION = 2 / 10000;

/** Min ticks after EXIT before accepting a new signal (proxy for "candles"). */
export const COOLDOWN_CANDLES = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  private running = false;
  private loopPromise: Promise<void> | null = null;

  private address: string | null = null;
  private candles: MarketCandle[] = [];

  private mode: EngineMode = "MANUAL";
  private state: EngineState = "IDLE";
  private tickCount = 0;
  private currentPrice: number | null = null;

  private lastUpdateTime = 0;
  /** Set to `tickCount` on each EXIT (FSM cooldown). */
  private lastExitTick: number | null = null;

  constructor(
    private readonly marketService: MarketService,
    private readonly stateStore: StateStore,
  ) {}

  start(address: string): { ok: true } {
    const trimmed = (address ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException("address is required");
    }
    if (this.running) {
      throw new BadRequestException("Engine is already running");
    }

    const candles = this.marketService.getCandles({
      symbol: "eth",
      interval: "4h",
      limit: 10000,
    });
    if (candles.length < 80) {
      throw new BadRequestException("Not enough candles to run engine");
    }

    this.address = trimmed;
    this.candles = candles;
    this.mode = "MANUAL";
    this.state = "IDLE";
    this.tickCount = 0;
    this.currentPrice = null;
    this.lastUpdateTime = Date.now();
    this.lastExitTick = null;
    this.stateStore.resetTradingState();

    this.running = true;
    this.loopPromise = this.runLoop();

    return { ok: true };
  }

  /**
   * External signal injection. Only accepted in IDLE and outside post-exit cooldown.
   */
  onSignal(signal: CopierSignalPayload): OnSignalResult {
    if (!this.running) {
      throw new BadRequestException("Engine is not running");
    }
    if (signal.type !== "BUY" && signal.type !== "SELL") {
      throw new BadRequestException('signal.type must be "BUY" or "SELL"');
    }

    if (this.state !== "IDLE") {
      this.stateStore.addEvent({
        type: "INVALID_SIGNAL",
        message: "Signal ignored due to state",
      });
      return { ok: true, ignored: true };
    }

    if (
      this.lastExitTick !== null &&
      this.tickCount - this.lastExitTick < COOLDOWN_CANDLES
    ) {
      const need = COOLDOWN_CANDLES - (this.tickCount - this.lastExitTick);
      this.stateStore.addEvent({
        type: "COOLDOWN_BLOCK",
        message: `Cooldown active; need ~${need} more tick(s) (cooldown=${COOLDOWN_CANDLES})`,
      });
      return { ok: true, ignored: true };
    }

    const token = this.address ?? "";
    const domainSignal: DomainSignal = {
      id: createEntityId(),
      token,
      type: signal.type,
      price: this.currentPrice ?? 0,
      createdAt: Date.now(),
    };
    this.stateStore.setSignal(domainSignal);
    this.state = "WAITING_ENTRY";
    this.stateStore.addEvent({
      type: "SIGNAL",
      message: signal.type,
    });

    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    this.running = false;
    this.stateStore.setSignal(null);
    if (this.state === "WAITING_ENTRY") {
      this.state = "IDLE";
    }
    this.stateStore.addEvent({
      type: "ERROR",
      message: "Engine stop requested",
    });
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    this.lastUpdateTime = Date.now();
    return { ok: true };
  }

  getStatus(): EngineStatusDto {
    const position = this.stateStore.getPosition();
    const entryPrice =
      this.state === "IN_POSITION" && position ? position.entryPrice : null;

    const pending = this.stateStore.getSignal();
    const pendingSignalType =
      this.state === "WAITING_ENTRY" && pending ? pending.type : null;

    const cooldownTicksRemaining =
      this.lastExitTick === null
        ? 0
        : Math.max(0, COOLDOWN_CANDLES - (this.tickCount - this.lastExitTick));

    return {
      running: this.running,
      mode: this.mode,
      state: this.state,
      currentPrice: this.currentPrice,
      entryPrice,
      pendingSignalType,
      position:
        this.state === "IN_POSITION" ? position : null,
      tickCount: this.tickCount,
      lastUpdateTime: this.lastUpdateTime,
      lastExitTick: this.lastExitTick,
      cooldownCandles: COOLDOWN_CANDLES,
      cooldownTicksRemaining,
      address: this.address,
    };
  }

  getResult(): EngineResultDto {
    const trades = this.stateStore.getTrades();
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.pnl > 0).length;
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const winRate = totalTrades ? wins / totalTrades : 0;

    return {
      trades: [...trades],
      stats: {
        totalTrades,
        winRate,
        totalPnL,
      },
    };
  }

  private async runLoop(): Promise<void> {
    try {
      while (this.running) {
        let livePrice: number;
        try {
          livePrice = await this.marketService.getLatestPrice();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`getLatestPrice failed: ${msg}`);
          this.stateStore.addEvent({
            type: "ERROR",
            message: msg,
          });
          this.lastUpdateTime = Date.now();
          await sleep(TICK_MS);
          continue;
        }

        this.tickCount++;
        this.currentPrice = livePrice;
        const tSec = nowUnixSec();

        switch (this.state) {
          case "IDLE": {
            if (this.mode === "AUTO") {
              // Reserved: internal strategy signals (not implemented).
            }
            break;
          }
          case "WAITING_ENTRY": {
            const pendingSignal = this.stateStore.getSignal();
            if (!pendingSignal) {
              this.state = "IDLE";
              break;
            }
            if (this.mode !== "MANUAL") {
              break;
            }

            const entryPrice = livePrice;
            const sig = pendingSignal;
            const token = this.address ?? "";

            if (sig.type === "BUY") {
              const stopLoss = entryPrice * (1 - MANUAL_SL_FRACTION);
              const takeProfit = entryPrice * (1 + MANUAL_TP_FRACTION);
              this.stateStore.setPosition({
                id: createEntityId(),
                token,
                side: "LONG",
                entryTime: tSec,
                entryPrice,
                stopLoss,
                takeProfit,
                status: "OPEN",
              });
            } else {
              const stopLoss = entryPrice * (1 + MANUAL_SL_FRACTION);
              const takeProfit = entryPrice * (1 - MANUAL_TP_FRACTION);
              this.stateStore.setPosition({
                id: createEntityId(),
                token,
                side: "SHORT",
                entryTime: tSec,
                entryPrice,
                stopLoss,
                takeProfit,
                status: "OPEN",
              });
            }

            const opened = this.stateStore.getPosition();
            this.stateStore.addEvent({
              type: "ENTRY",
              price: entryPrice,
              message: `${sig.type} @ market (${opened?.side})`,
            });
            this.stateStore.setSignal(null);
            this.state = "IN_POSITION";
            break;
          }
          case "IN_POSITION": {
            const pos = this.stateStore.getPosition();
            if (!pos) {
              this.state = "IDLE";
              break;
            }

            if (pos.side === "LONG") {
              if (livePrice <= pos.stopLoss) {
                this.pushTradeAndReset(pos, tSec, pos.stopLoss, "stop_loss");
                break;
              }
              if (livePrice >= pos.takeProfit) {
                this.pushTradeAndReset(pos, tSec, pos.takeProfit, "take_profit");
                break;
              }
            } else {
              if (livePrice >= pos.stopLoss) {
                this.pushTradeAndReset(pos, tSec, pos.stopLoss, "stop_loss");
                break;
              }
              if (livePrice <= pos.takeProfit) {
                this.pushTradeAndReset(pos, tSec, pos.takeProfit, "take_profit");
                break;
              }
            }
            break;
          }
          default:
            break;
        }

        this.lastUpdateTime = Date.now();
        await sleep(TICK_MS);
      }
    } catch (err) {
      this.logger.error("Engine loop error", err);
      this.stateStore.addEvent({
        type: "ERROR",
        message: `Engine loop crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.lastUpdateTime = Date.now();
      this.running = false;
    }
  }

  private pushTradeAndReset(
    pos: Position,
    exitTime: number,
    exitPrice: number,
    reason: "stop_loss" | "take_profit",
  ) {
    this.stateStore.addEvent({
      type: "EXIT",
      price: exitPrice,
      message: `${reason} (${pos.side})`,
    });
    const pnl =
      pos.side === "LONG"
        ? exitPrice - pos.entryPrice
        : pos.entryPrice - exitPrice;
    const trade: Trade = {
      id: createEntityId(),
      token: pos.token,
      side: pos.side,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime,
      exitPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      pnl,
      status: "CLOSED",
    };
    this.stateStore.addTrade(trade);
    this.stateStore.setPosition(null);
    this.state = "IDLE";
    this.lastExitTick = this.tickCount;
  }
}
