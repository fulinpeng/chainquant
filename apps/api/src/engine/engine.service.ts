import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import type { TradeRecord } from "../trading/trading.service";
import { TradingService } from "../trading/trading.service";

export type EngineState = "IDLE" | "WAITING_ENTRY" | "IN_POSITION";

export type EngineSignal = {
  price: number;
  timestamp: number;
  expireIndex: number;
};

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
  entryPrice: number | null;
  position: EnginePosition | null;
  currentIndex: number;
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

const TICK_MS = 500;
const ATR_PERIOD = 14;
const SIGNAL_EVERY = 50;
const ENTRY_TIMEOUT_BARS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  private running = false;
  private loopPromise: Promise<void> | null = null;

  private address: string | null = null;
  private candles: MarketCandle[] = [];

  private state: EngineState = "IDLE";
  private currentIndex = -1;
  private currentPrice: number | null = null;

  private currentSignal: EngineSignal | null = null;
  private currentPosition: EnginePosition | null = null;

  private trades: TradeRecord[] = [];

  constructor(
    private readonly marketService: MarketService,
    private readonly tradingService: TradingService,
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
    this.currentIndex = -1;
    this.currentPrice = null;
    this.currentSignal = null;
    this.currentPosition = null;
    this.trades = [];

    this.running = true;
    this.loopPromise = this.runLoop();

    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    return { ok: true };
  }

  getStatus(): EngineStatusDto {
    const entryPrice =
      this.state === "WAITING_ENTRY" && this.currentSignal
        ? this.currentSignal.price * 0.97
        : this.state === "IN_POSITION" && this.currentPosition
          ? this.currentPosition.entryPrice
          : null;

    return {
      running: this.running,
      state: this.state,
      currentPrice: this.currentPrice,
      entryPrice,
      position: this.currentPosition,
      currentIndex: this.currentIndex,
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
        this.currentIndex++;
        if (this.currentIndex >= this.candles.length) {
          this.logger.log("Reached end of candles; stopping engine.");
          this.running = false;
          break;
        }

        const candle = this.candles[this.currentIndex];
        const currentPrice = candle.close;
        this.currentPrice = currentPrice;

        switch (this.state) {
          case "IDLE": {
            if (
              this.currentIndex > 0 &&
              this.currentIndex % SIGNAL_EVERY === 0
            ) {
              const signalPrice = currentPrice;
              this.currentSignal = {
                price: signalPrice,
                timestamp: candle.time,
                expireIndex: this.currentIndex + ENTRY_TIMEOUT_BARS,
              };
              this.state = "WAITING_ENTRY";
            }
            break;
          }
          case "WAITING_ENTRY": {
            if (!this.currentSignal) {
              this.state = "IDLE";
              break;
            }
            const entryTarget = this.currentSignal.price * 0.97;

            if (this.currentIndex > this.currentSignal.expireIndex) {
              this.currentSignal = null;
              this.state = "IDLE";
              break;
            }

            if (currentPrice <= entryTarget) {
              const atr = this.tradingService.computeAtr(
                this.candles,
                this.currentIndex,
                ATR_PERIOD,
              );
              if (atr !== null && Number.isFinite(atr) && atr > 0) {
                const entryPrice = entryTarget;
                const stopLoss = entryPrice - atr * 2;
                const takeProfit =
                  entryPrice + (entryPrice - stopLoss) * 2;
                this.currentPosition = {
                  entryTime: candle.time,
                  entryPrice,
                  stopLoss,
                  takeProfit,
                  status: "OPEN",
                };
                this.currentSignal = null;
                this.state = "IN_POSITION";
              } else {
                this.currentSignal = null;
                this.state = "IDLE";
              }
            }
            break;
          }
          case "IN_POSITION": {
            if (!this.currentPosition) {
              this.state = "IDLE";
              break;
            }
            const pos = this.currentPosition;

            if (currentPrice <= pos.stopLoss) {
              this.pushTradeAndReset(pos, candle.time, pos.stopLoss);
              break;
            }
            if (currentPrice >= pos.takeProfit) {
              this.pushTradeAndReset(pos, candle.time, pos.takeProfit);
              break;
            }
            break;
          }
          default:
            break;
        }

        await sleep(TICK_MS);
      }
    } catch (err) {
      this.logger.error("Engine loop error", err);
      this.running = false;
    }
  }

  private pushTradeAndReset(
    pos: EnginePosition,
    exitTime: number,
    exitPrice: number,
  ) {
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
