import { BadRequestException, Logger } from "@nestjs/common";
import { CHAINS } from "../config/chains";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import { ExecutionService } from "../execution/execution.service";
import { createEntityId } from "../domain/id";
import type { Position } from "../domain/position";
import type { Signal as DomainSignal } from "../domain/signal";
import type { Trade } from "../domain/trade";
import { StateStore } from "../state/state-store.service";
import type {
  CopierSignalPayload,
  EngineRuntimeConfig,
  EngineResultDto,
  EngineState,
  EngineStatusDto,
  OnSignalResult,
} from "./types";
import { COOLDOWN_CANDLES } from "./types";

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * One live trading instance: isolated {@link StateStore}, single `token` book.
 */
export class TradingEngine {
  private readonly logger: Logger;
  private readonly stateStore = new StateStore();
  private readonly account = { balance: 10000 };
  private pendingSignalTick: number | null = null;

  private running = false;
  private candles: MarketCandle[] = [];

  private mode: "MANUAL" | "AUTO" = "MANUAL";
  private state: EngineState = "IDLE";
  private tickCount = 0;
  private currentPrice: number | null = null;
  private lastUpdateTime = 0;
  private lastExitTick: number | null = null;

  constructor({
    marketService,
    executionService,
    address,
    token,
    config,
  }: {
    marketService: MarketService;
    executionService: ExecutionService;
    address: string;
    token: string;
    config: EngineRuntimeConfig;
  }) {
    this.marketService = marketService;
    this.executionService = executionService;
    this.address = address;
    this.token = token;
    this.config = config;
    this.logger = new Logger(`TradingEngine:${address.slice(0, 8)}_${token.slice(0, 8)}`);
  }
  private readonly marketService: MarketService;
  private readonly executionService: ExecutionService;
  public readonly address: string;
  public readonly token: string;
  private config: EngineRuntimeConfig;

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(config: EngineRuntimeConfig): void {
    this.config = config;
  }

  start(): { ok: true } {
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

    this.candles = candles;
    this.mode = "MANUAL";
    this.state = "IDLE";
    this.tickCount = 0;
    this.currentPrice = null;
    this.lastUpdateTime = Date.now();
    this.lastExitTick = null;
    this.pendingSignalTick = null;
    this.stateStore.resetTradingState();

    this.running = true;
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
    this.lastUpdateTime = Date.now();
    return { ok: true };
  }

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

    if (this.config.maxPositions < 1) {
      this.stateStore.addEvent({
        type: "INVALID_SIGNAL",
        message: "Signal ignored due to maxPositions < 1",
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

    const domainSignal: DomainSignal = {
      id: createEntityId(),
      token: this.token,
      type: signal.type,
      price: signal.price ?? this.currentPrice ?? 0,
      createdAt: Date.now(),
    };
    this.triggerExecution(signal);
    this.stateStore.setSignal(domainSignal);
    this.state = "WAITING_ENTRY";
    this.pendingSignalTick = this.tickCount;
    this.stateStore.addEvent({
      type: "SIGNAL",
      message: signal.type,
    });

    return { ok: true };
  }

  private triggerExecution(signal: CopierSignalPayload): void {
    const wrapped = CHAINS.arb.wrappedNative.address;
    const tokenIn = signal.type === "BUY" ? wrapped : this.token;
    const tokenOut = signal.type === "BUY" ? this.token : wrapped;
    void this.executionService
      .execute({
        mode: this.config.mode,
        tokenIn,
        tokenOut,
        amountInRaw: signal.amount,
        maxTradeAmount: this.config.maxTradeAmount,
        slippage: this.config.slippage,
      })
      .then((result) => {
        if (!result.ok) {
          this.stateStore.addEvent({
            type: "ERROR",
            message: `Execution failed: ${result.reason}`,
          });
          return;
        }
        if (result.mode === "live" && result.txHash) {
          const quoteInfo = result.debug
            ? `amountIn=${result.debug.amountIn} quoteOut=${result.debug.quoteAmountOut} minOut=${result.debug.minOut} slippage=${result.debug.slippage}`
            : "quote=na";
          this.stateStore.addEvent({
            type: "EXECUTION",
            message: `Live tx sent: ${result.txHash} | ${quoteInfo}`,
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.stateStore.addEvent({
          type: "ERROR",
          message: `Execution crashed: ${msg}`,
        });
      });
  }

  /** Single scheduler tick: fetch price and advance FSM once. */
  async onTick(): Promise<void> {
    if (!this.running) return;

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
      return;
    }

    this.tickCount++;
    this.currentPrice = livePrice;
    const tSec = nowUnixSec();

    try {
      switch (this.state) {
        case "IDLE": {
          if (this.mode === "AUTO") {
            /* reserved */
          }
          break;
        }
        case "WAITING_ENTRY": {
          const pendingSignal = this.stateStore.getSignal();
          if (!pendingSignal) {
            this.state = "IDLE";
            break;
          }
          if (this.mode !== "MANUAL") break;
          if (
            this.config.delayEntry &&
            this.pendingSignalTick !== null &&
            this.tickCount <= this.pendingSignalTick
          ) {
            break;
          }

          const entryPrice = livePrice;
          const sig = pendingSignal;

          if (sig.type === "BUY") {
            const stopLoss = entryPrice * (1 - this.config.stopLossPct);
            const takeProfit = entryPrice * (1 + this.config.takeProfitPct);
            const size = this.computePositionSize(entryPrice, stopLoss);
            this.stateStore.setPosition({
              id: createEntityId(),
              token: this.token,
              side: "LONG",
              entryTime: tSec,
              entryPrice,
              size,
              stopLoss,
              takeProfit,
              status: "OPEN",
            });
          } else {
            const stopLoss = entryPrice * (1 + this.config.stopLossPct);
            const takeProfit = entryPrice * (1 - this.config.takeProfitPct);
            const size = this.computePositionSize(entryPrice, stopLoss);
            this.stateStore.setPosition({
              id: createEntityId(),
              token: this.token,
              side: "SHORT",
              entryTime: tSec,
              entryPrice,
              size,
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
          if (opened) {
            this.stateStore.addTrade({
              id: createEntityId(),
              token: opened.token,
              side: opened.side,
              entryTime: opened.entryTime,
              entryPrice: opened.entryPrice,
              size: opened.size,
              exitTime: null,
              exitPrice: null,
              stopLoss: opened.stopLoss,
              takeProfit: opened.takeProfit,
              pnl: null,
              status: "OPEN",
            });
          }
          this.stateStore.setSignal(null);
          this.pendingSignalTick = null;
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
    } catch (err) {
      this.logger.error("onTick error", err);
      this.stateStore.addEvent({
        type: "ERROR",
        message: `Engine tick crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.running = false;
    }

    this.lastUpdateTime = Date.now();
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
      address: this.address,
      token: this.token,
      currentPrice: this.currentPrice,
      entryPrice,
      pendingSignalType,
      position: this.state === "IN_POSITION" ? position : null,
      tickCount: this.tickCount,
      lastUpdateTime: this.lastUpdateTime,
      lastExitTick: this.lastExitTick,
      cooldownCandles: COOLDOWN_CANDLES,
      cooldownTicksRemaining,
    };
  }

  getResult(): EngineResultDto {
    const trades = this.stateStore.getTrades();
    const totalTrades = trades.length;
    const closed = trades.filter((t) => t.status === "CLOSED" && t.pnl !== null);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnL = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = closed.length ? wins / closed.length : 0;

    return {
      trades: [...trades],
      stats: {
        totalTrades,
        winRate,
        totalPnL,
      },
    };
  }

  getRecentEvents(limit: number) {
    const events = this.stateStore.getEvents();
    const n = Math.min(Math.max(1, limit), events.length);
    return events.slice(-n);
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
        ? (exitPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - exitPrice) * pos.size;
    const openTrade = this.stateStore
      .getTrades()
      .find((t) => t.status === "OPEN" && t.entryTime === pos.entryTime && t.token === pos.token);
    if (openTrade) {
      this.stateStore.updateTrade(openTrade.id, {
        exitTime,
        exitPrice,
        pnl,
        status: "CLOSED",
      });
    } else {
      // Fallback for robustness if OPEN trade record is missing.
      const trade: Trade = {
        id: createEntityId(),
        token: pos.token,
        side: pos.side,
        entryTime: pos.entryTime,
        entryPrice: pos.entryPrice,
        size: pos.size,
        exitTime,
        exitPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        pnl,
        status: "CLOSED",
      };
      this.stateStore.addTrade(trade);
    }
    this.stateStore.setPosition(null);
    this.state = "IDLE";
    this.lastExitTick = this.tickCount;
  }

  private computePositionSize(entryPrice: number, stopLoss: number): number {
    const riskAmount = this.account.balance * this.config.riskPerTrade;
    const stopLossDistance = Math.abs(entryPrice - stopLoss);
    if (!Number.isFinite(stopLossDistance) || stopLossDistance <= 0) {
      return 0;
    }
    const riskBasedSize = riskAmount / stopLossDistance;
    const cap = Number(this.config.maxTradeAmount);
    if (!Number.isFinite(cap) || cap < 0) {
      return riskBasedSize;
    }
    // No minimum trade-size floor: only cap by watcher config.
    return Math.min(riskBasedSize, cap);
  }
}
