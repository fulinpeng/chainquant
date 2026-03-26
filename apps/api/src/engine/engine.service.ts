import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import { EventService } from "../event/event.service";
import type { TradeRecord } from "../trading/trading.service";

export type EngineState = "IDLE" | "IN_POSITION";

export type EnginePosition = {
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN";
};

export type EngineStatusDto = {
  running: boolean;
  state: EngineState;
  currentPrice: number | null;
  /** IN_POSITION: position entry price (manual trigger uses submitted price). */
  entryPrice: number | null;
  position: EnginePosition | null;
  /** Number of live price ticks processed (for observability). */
  tickCount: number;
  /** Unix ms — last time the engine loop finished a tick (or handled a price error). */
  lastUpdateTime: number;
  address: string | null;
};

export type EngineResultDto = {
  trades: TradeRecord[];
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
  };
};

const TICK_MS = 2000;
/** Manual long: stop-loss = entry × (1 − 1/10000). */
const MANUAL_SL_FRACTION = 1 / 10000;
/** Manual long: take-profit = entry × (1 + 2/10000). */
const MANUAL_TP_FRACTION = 2 / 10000;

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

  private state: EngineState = "IDLE";
  private tickCount = 0;
  private currentPrice: number | null = null;

  private currentPosition: EnginePosition | null = null;

  private trades: TradeRecord[] = [];

  /** Last loop activity time (ms). */
  private lastUpdateTime = 0;

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
    this.state = "IDLE";
    this.tickCount = 0;
    this.currentPrice = null;
    this.currentPosition = null;
    this.trades = [];
    this.lastUpdateTime = Date.now();

    this.running = true;
    this.loopPromise = this.runLoop();

    return { ok: true };
  }

  /**
   * Manual entry (IDLE only): open long at submitted price.
   * SL = entry × (1 − 1/10000), TP = entry × (1 + 2/10000).
   */
  triggerSignal(price: number): { ok: true } {
    if (!this.running) {
      throw new BadRequestException("Engine is not running");
    }
    if (this.state !== "IDLE") {
      throw new BadRequestException(
        "triggerSignal only allowed when state is IDLE",
      );
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException("price must be a positive number");
    }

    const entryPrice = price;
    const stopLoss = entryPrice * (1 - MANUAL_SL_FRACTION);
    const takeProfit = entryPrice * (1 + MANUAL_TP_FRACTION);

    this.eventService.addEvent({
      type: "SIGNAL",
      price,
      message: "Manual triggerSignal",
    });
    this.eventService.addEvent({
      type: "ENTRY",
      price: entryPrice,
      message: `SL=${stopLoss.toFixed(4)} TP=${takeProfit.toFixed(4)}`,
    });

    this.currentPosition = {
      entryTime: nowUnixSec(),
      entryPrice,
      stopLoss,
      takeProfit,
      status: "OPEN",
    };
    this.state = "IN_POSITION";

    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    this.running = false;
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

    return {
      running: this.running,
      state: this.state,
      currentPrice: this.currentPrice,
      entryPrice,
      position: this.currentPosition,
      tickCount: this.tickCount,
      lastUpdateTime: this.lastUpdateTime,
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
            break;
          }
          case "IN_POSITION": {
            if (!this.currentPosition) {
              this.state = "IDLE";
              break;
            }
            const pos = this.currentPosition;

            if (livePrice <= pos.stopLoss) {
              this.pushTradeAndReset(pos, tSec, pos.stopLoss, "stop_loss");
              break;
            }
            if (livePrice >= pos.takeProfit) {
              this.pushTradeAndReset(pos, tSec, pos.takeProfit, "take_profit");
              break;
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
      message: reason,
    });
    this.trades.push({
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime,
      exitPrice,
      profit: exitPrice - pos.entryPrice,
    });
    this.currentPosition = null;
    this.state = "IDLE";
  }
}
