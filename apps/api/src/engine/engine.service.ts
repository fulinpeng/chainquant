import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import { EventService } from "../event/event.service";
import type { TradeRecord } from "../trading/trading.service";

export type EngineMode = "MANUAL" | "AUTO";

export type Signal = {
  type: "BUY" | "SELL";
};

export type EngineState = "IDLE" | "WAITING_ENTRY" | "IN_POSITION";

export type PositionSide = "LONG" | "SHORT";

export type EnginePosition = {
  side: PositionSide;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN";
};

export type EngineStatusDto = {
  running: boolean;
  mode: EngineMode;
  state: EngineState;
  currentPrice: number | null;
  /** IN_POSITION: entry price. */
  entryPrice: number | null;
  /** WAITING_ENTRY: which external signal is pending. */
  pendingSignalType: "BUY" | "SELL" | null;
  position: EnginePosition | null;
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
  trades: TradeRecord[];
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

  private pendingSignal: Signal | null = null;
  private currentPosition: EnginePosition | null = null;

  private trades: TradeRecord[] = [];

  private lastUpdateTime = 0;
  /** Set to `tickCount` on each EXIT (FSM cooldown). */
  private lastExitTick: number | null = null;

  constructor(
    private readonly marketService: MarketService,
    private readonly eventService: EventService,
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
    this.pendingSignal = null;
    this.tickCount = 0;
    this.currentPrice = null;
    this.currentPosition = null;
    this.trades = [];
    this.lastUpdateTime = Date.now();
    this.lastExitTick = null;

    this.running = true;
    this.loopPromise = this.runLoop();

    return { ok: true };
  }

  /**
   * External signal injection. Only accepted in IDLE and outside post-exit cooldown.
   */
  onSignal(signal: Signal): OnSignalResult {
    if (!this.running) {
      throw new BadRequestException("Engine is not running");
    }
    if (signal.type !== "BUY" && signal.type !== "SELL") {
      throw new BadRequestException('signal.type must be "BUY" or "SELL"');
    }

    if (this.state !== "IDLE") {
      this.eventService.addEvent({
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
      this.eventService.addEvent({
        type: "COOLDOWN_BLOCK",
        message: `Cooldown active; need ~${need} more tick(s) (cooldown=${COOLDOWN_CANDLES})`,
      });
      return { ok: true, ignored: true };
    }

    this.pendingSignal = signal;
    this.state = "WAITING_ENTRY";
    this.eventService.addEvent({
      type: "SIGNAL",
      message: signal.type,
    });

    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    this.running = false;
    this.pendingSignal = null;
    if (this.state === "WAITING_ENTRY") {
      this.state = "IDLE";
    }
    this.eventService.addEvent({
      type: "STOP",
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
    const entryPrice =
      this.state === "IN_POSITION" && this.currentPosition
        ? this.currentPosition.entryPrice
        : null;

    const pendingSignalType =
      this.state === "WAITING_ENTRY" && this.pendingSignal
        ? this.pendingSignal.type
        : null;

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
      position: this.currentPosition,
      tickCount: this.tickCount,
      lastUpdateTime: this.lastUpdateTime,
      lastExitTick: this.lastExitTick,
      cooldownCandles: COOLDOWN_CANDLES,
      cooldownTicksRemaining,
      address: this.address,
    };
  }

  getResult(): EngineResultDto {
    const totalTrades = this.trades.length;
    const wins = this.trades.filter((t) => t.profit > 0).length;
    const totalPnL = this.trades.reduce((sum, t) => sum + t.profit, 0);
    const winRate = totalTrades ? wins / totalTrades : 0;

    return {
      trades: [...this.trades],
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
          this.eventService.addEvent({
            type: "ERROR_FETCH_PRICE",
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
            if (!this.pendingSignal) {
              this.state = "IDLE";
              break;
            }
            if (this.mode !== "MANUAL") {
              break;
            }

            const entryPrice = livePrice;
            const sig = this.pendingSignal;

            if (sig.type === "BUY") {
              const stopLoss = entryPrice * (1 - MANUAL_SL_FRACTION);
              const takeProfit = entryPrice * (1 + MANUAL_TP_FRACTION);
              this.currentPosition = {
                side: "LONG",
                entryTime: tSec,
                entryPrice,
                stopLoss,
                takeProfit,
                status: "OPEN",
              };
            } else {
              const stopLoss = entryPrice * (1 + MANUAL_SL_FRACTION);
              const takeProfit = entryPrice * (1 - MANUAL_TP_FRACTION);
              this.currentPosition = {
                side: "SHORT",
                entryTime: tSec,
                entryPrice,
                stopLoss,
                takeProfit,
                status: "OPEN",
              };
            }

            this.eventService.addEvent({
              type: "ENTRY",
              price: entryPrice,
              message: `${sig.type} @ market (${this.currentPosition.side})`,
            });
            this.pendingSignal = null;
            this.state = "IN_POSITION";
            break;
          }
          case "IN_POSITION": {
            if (!this.currentPosition) {
              this.state = "IDLE";
              break;
            }
            const pos = this.currentPosition;

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
      this.eventService.addEvent({
        type: "ERROR_FETCH_PRICE",
        message: `Engine loop crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.lastUpdateTime = Date.now();
      this.running = false;
    }
  }

  private pushTradeAndReset(
    pos: EnginePosition,
    exitTime: number,
    exitPrice: number,
    reason: "stop_loss" | "take_profit",
  ) {
    this.eventService.addEvent({
      type: "EXIT",
      price: exitPrice,
      message: `${reason} (${pos.side})`,
    });
    const profit =
      pos.side === "LONG"
        ? exitPrice - pos.entryPrice
        : pos.entryPrice - exitPrice;
    this.trades.push({
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime,
      exitPrice,
      profit,
    });
    this.currentPosition = null;
    this.state = "IDLE";
    this.lastExitTick = this.tickCount;
  }
}
