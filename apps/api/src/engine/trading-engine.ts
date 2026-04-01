import { BadRequestException, Logger } from "@nestjs/common";
import { CHAINS } from "../config/chains";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";
import { ExecutionService } from "../execution/execution.service";
import { QuoterService } from "../execution/quoter.service";
import { FundsService } from "../risk/funds.service";
import { createEntityId } from "../domain/id";
import type { Position } from "../domain/position";
import type { Signal as DomainSignal } from "../domain/signal";
import type { Trade } from "../domain/trade";
import { StateStore } from "../state/state-store.service";
import type {
  CopierSignalPayload,
  EngineDbHooks,
  EngineRuntimeConfig,
  EngineResultDto,
  EngineState,
  EngineStatusDto,
  OnSignalResult,
} from "./types";
import { COOLDOWN_CANDLES } from "./types";
import type { EventType } from "../domain/event";
import { analyzeFvg } from "./fvg.util";
import { parseUnits } from "ethers";
import type { ExecuteResult } from "../execution/execution.service";
import { computeAtrSimpleAvgHighLow } from "../trading/trading.service";

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 单个实盘/模拟引擎实例：独立 {@link StateStore}，单一 `token` 标的。
 */
export class TradingEngine {
  private readonly logger: Logger;
  private readonly stateStore = new StateStore();
  private pendingSignalTick: number | null = null;

  private running = false;
  private candles: MarketCandle[] = [];

  private mode: "MANUAL" | "AUTO" = "MANUAL";
  private state: EngineState = "IDLE";
  private tickCount = 0;
  private currentPrice: number | null = null;
  private lastUpdateTime = 0;
  private lastExitTick: number | null = null;
  private executionPending = false;
  private executionReady = false;
  private executionFailReason: string | null = null;

  /** FVG 挂单等待（有预占资金，未发 execution） */
  private pendingOrder?: {
    entryPrice: number;
    direction: "BUY" | "SELL";
    amountIn: number;
    expireAt: number;
  };
  private pendingExecutionSignal?: CopierSignalPayload;
  private reservationActive: { amount: number } | null = null;

  constructor({
    marketService,
    executionService,
    quoterService,
    fundsService,
    address,
    token,
    config,
    dbHooks,
  }: {
    marketService: MarketService;
    executionService: ExecutionService;
    quoterService: QuoterService;
    fundsService: FundsService;
    address: string;
    token: string;
    config: EngineRuntimeConfig;
    dbHooks?: EngineDbHooks;
  }) {
    this.marketService = marketService;
    this.executionService = executionService;
    this.quoterService = quoterService;
    this.fundsService = fundsService;
    this.address = address;
    this.token = token;
    this.config = config;
    this.dbHooks = dbHooks;
    this.logger = new Logger(`TradingEngine:${address.slice(0, 8)}_${token.slice(0, 8)}`);
  }
  private readonly marketService: MarketService;
  private readonly executionService: ExecutionService;
  private readonly quoterService: QuoterService;
  private readonly fundsService: FundsService;
  private readonly dbHooks?: EngineDbHooks;
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
    this.executionPending = false;
    this.executionReady = false;
    this.executionFailReason = null;
    this.pendingOrder = undefined;
    this.pendingExecutionSignal = undefined;
    this.reservationActive = null;
    this.stateStore.resetTradingState();

    this.running = true;
    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    this.running = false;
    this.stateStore.setSignal(null);
    this.clearFvgPending();
    if (this.state === "WAITING_ENTRY") {
      this.state = "IDLE";
    }
    this.releaseReservationTracked();
    this.stateStore.addEvent({
      type: "ERROR",
      message: "Engine stop requested",
    });
    this.lastUpdateTime = Date.now();
    return { ok: true };
  }

  async onSignal(signal: CopierSignalPayload): Promise<OnSignalResult> {
    if (!this.running) {
      throw new BadRequestException("Engine is not running");
    }
    if (signal.type !== "BUY" && signal.type !== "SELL") {
      throw new BadRequestException('signal.type must be "BUY" or "SELL"');
    }

    if (this.state !== "IDLE") {
      this.emitEv("INVALID_SIGNAL", "Signal ignored due to state");
      return { ok: true, ignored: true };
    }

    if (this.config.maxPositions < 1) {
      this.emitEv("INVALID_SIGNAL", "Signal ignored due to maxPositions < 1");
      return { ok: true, ignored: true };
    }

    if (
      this.lastExitTick !== null &&
      this.tickCount - this.lastExitTick < COOLDOWN_CANDLES
    ) {
      const need = COOLDOWN_CANDLES - (this.tickCount - this.lastExitTick);
      this.emitEv(
        "COOLDOWN_BLOCK",
        `Cooldown active; need ~${need} more tick(s) (cooldown=${COOLDOWN_CANDLES})`,
      );
      return { ok: true, ignored: true };
    }

    const equity = this.config.accountEquityUsdt;
    if (!Number.isFinite(equity) || equity <= 0) {
      this.emitEv("RESERVATION_FAILED", "accountEquityUsdt invalid", {
        reason: "invalid_account_equity",
      });
      return { ok: true, ignored: true };
    }

    const maxTa = Number(this.config.maxTradeAmount);
    if (!Number.isFinite(maxTa) || maxTa <= 0) {
      this.emitEv("RESERVATION_FAILED", "maxTradeAmount invalid", {
        reason: "invalid_max_trade_amount",
      });
      return { ok: true, ignored: true };
    }

    const refPx = await this.resolveRefPriceUsd(signal);
    if (refPx == null || !Number.isFinite(refPx) || refPx <= 0) {
      this.emitEv("RESERVATION_FAILED", "Cannot resolve token price for reservation", {
        reason: "no_ref_price",
      });
      return { ok: true, ignored: true };
    }

    const provisionalStop =
      signal.type === "BUY"
        ? refPx * (1 - this.config.stopLossPct)
        : refPx * (1 + this.config.stopLossPct);
    const provisionalSize = this.computePositionSize(refPx, provisionalStop);
    const notionalUsd = provisionalSize * refPx;
    const reserveAmount = Math.min(
      Math.max(notionalUsd, 1e-9),
      equity,
    );

    if (!Number.isFinite(reserveAmount) || reserveAmount <= 0) {
      this.emitEv("RESERVATION_FAILED", "Computed reservation notional is zero", {
        reason: "zero_reserve_notional",
        refPx,
        provisionalSize,
      });
      return { ok: true, ignored: true };
    }

    const okReserve = this.fundsService.reserve(
      this.address,
      reserveAmount,
      equity,
    );
    if (!okReserve) {
      this.emitEv("RESERVATION_FAILED", "Insufficient balance for reservation", {
        address: this.address,
        amount: reserveAmount,
        balance: equity,
        reserved: this.fundsService.getReserved(this.address),
      });
      return { ok: true, ignored: true };
    }
    this.reservationActive = { amount: reserveAmount };

    if (this.config.entryMode !== "pullback") {
      return this.onSignalLegacyAfterReserve(signal, reserveAmount);
    }

    try {
      const candles = await this.marketService.getDexscreenerChartCandlesForArbitrum(
        this.token,
        20,
      );
      const fvg = analyzeFvg(candles, signal.type);
      if (fvg.count < 2 || fvg.latestMid == null) {
        this.releaseReservationTracked();
        this.emitEv("FVG_REJECTED", "FVG count < 2 or no mid", {
          count: fvg.count,
          direction: signal.type,
        });
        return { ok: true, ignored: true };
      }

      const entryPrice = fvg.latestMid;
      const tokenUsd = await this.marketService.getLatestPriceByToken(this.token);
      this.currentPrice = tokenUsd;

      let devQuotePct: number;
      try {
        devQuotePct = await this.computeQuoteVsDexDeviationPct(tokenUsd, signal.type);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.releaseReservationTracked();
        this.emitEv("FVG_REJECTED", `quote check failed: ${msg}`, { reason: "quote_failed" });
        return { ok: true, ignored: true };
      }
      if (devQuotePct > 0.02) {
        this.releaseReservationTracked();
        this.emitEv("FVG_REJECTED", "Dex vs quoter deviation > 2%", {
          deviationPct: devQuotePct,
        });
        return { ok: true, ignored: true };
      }

      const devEntryPct = Math.abs(entryPrice - tokenUsd) / tokenUsd;
      if (devEntryPct > 0.05) {
        this.releaseReservationTracked();
        this.emitEv("FVG_REJECTED", "entryPrice vs spot deviation > 5%", {
          deviationPct: devEntryPct,
          entryPrice,
          spot: tokenUsd,
        });
        return { ok: true, ignored: true };
      }

      const immediate =
        signal.type === "BUY"
          ? tokenUsd <= entryPrice
          : tokenUsd >= entryPrice;

      const domainSignal: DomainSignal = {
        id: createEntityId(),
        token: this.token,
        type: signal.type,
        price: signal.price ?? tokenUsd,
        createdAt: Date.now(),
      };

      if (immediate) {
        this.emitEv("ORDER_TRIGGERED", "Immediate FVG entry", {
          entryPrice,
          spot: tokenUsd,
          direction: signal.type,
        });
        try {
          this.executionPending = true;
          this.executionReady = false;
          this.executionFailReason = null;
          const result = await this.runExecution(signal, tokenUsd);
          this.applyExecutionResult(result, signal);
          const canEnter = this.canEnterFromExecutionResult(result);
          if (canEnter) {
            this.enterInPositionAtPrice(tokenUsd, signal.type, nowUnixSec());
            this.stateStore.setSignal(null);
            this.pendingSignalTick = null;
          } else {
            this.stateStore.setSignal(null);
            this.pendingSignalTick = null;
            this.state = "IDLE";
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emitEv("ERROR", `FVG immediate execution crashed: ${msg}`);
          this.state = "IDLE";
          this.stateStore.setSignal(null);
          this.pendingSignalTick = null;
        } finally {
          this.executionPending = false;
          this.releaseReservationTracked();
        }
        this.stateStore.addEvent({ type: "SIGNAL", message: signal.type });
        return { ok: true };
      }

      this.pendingOrder = {
        entryPrice,
        direction: signal.type,
        amountIn: reserveAmount,
        expireAt: Date.now() + this.config.entryTimeoutMs,
      };
      this.pendingExecutionSignal = { ...signal };
      this.stateStore.setSignal(domainSignal);
      this.state = "WAITING_ENTRY";
      this.pendingSignalTick = this.tickCount;
      this.emitEv("ORDER_PLACED", "FVG limit wait", {
        entryPrice,
        expireAt: this.pendingOrder.expireAt,
        direction: signal.type,
        amountIn: reserveAmount,
      });
      this.stateStore.addEvent({ type: "SIGNAL", message: signal.type });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.releaseReservationTracked();
      this.emitEv("FVG_REJECTED", msg, { phase: "fvg_pipeline" });
      return { ok: true, ignored: true };
    }
  }

  /** 原逻辑：预占成功后立即发起 execution，WAITING_ENTRY 等成交再在 tick 入场。 */
  private onSignalLegacyAfterReserve(
    signal: CopierSignalPayload,
    _reserveAmount: number,
  ): OnSignalResult {
    const domainSignal: DomainSignal = {
      id: createEntityId(),
      token: this.token,
      type: signal.type,
      price: signal.price ?? this.currentPrice ?? 0,
      createdAt: Date.now(),
    };
    this.executionPending = true;
    this.executionReady = false;
    this.executionFailReason = null;
    void this.runExecution(
      signal,
      domainSignal.price > 0 ? domainSignal.price : undefined,
    )
      .then((result) => {
        try {
          this.applyExecutionResult(result, signal);
        } finally {
          this.releaseReservationTracked();
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.executionPending = false;
        this.executionReady = false;
        this.executionFailReason = msg;
        this.releaseReservationTracked();
        void this.dbHooks?.onExecutionEvent?.({
          ok: false,
          mode: "live",
          reason: msg,
          data: { reason: msg },
        });
        this.emitEv("ERROR", `Execution crashed: ${msg}`);
      });
    this.stateStore.setSignal(domainSignal);
    this.state = "WAITING_ENTRY";
    this.pendingSignalTick = this.tickCount;
    this.stateStore.addEvent({ type: "SIGNAL", message: signal.type });
    return { ok: true };
  }

  private emitEv(
    type: EventType,
    message: string,
    data?: Record<string, unknown>,
    price?: number,
  ): void {
    this.stateStore.addEvent({ type, message, data, price });
  }

  private releaseReservationTracked(): void {
    if (this.reservationActive) {
      this.fundsService.release(this.address, this.reservationActive.amount);
      this.reservationActive = null;
    }
  }

  private clearFvgPending(): void {
    this.pendingOrder = undefined;
    this.pendingExecutionSignal = undefined;
  }

  /**
   * @param entryPriceUsdHint 用于 live 下按仓位模式换算 amountIn（BUY=WETH 数量，SELL=代币数量）；缺省时再拉现价。
   */
  private async runExecution(
    signal: CopierSignalPayload,
    entryPriceUsdHint?: number,
  ): Promise<ExecuteResult> {
    const wrapped = CHAINS.arb.wrappedNative.address;
    const tokenIn = signal.type === "BUY" ? wrapped : this.token;
    const tokenOut = signal.type === "BUY" ? this.token : wrapped;

    if (this.config.mode === "paper") {
      return this.executionService.execute({
        mode: "paper",
        tokenIn,
        tokenOut,
        amountInRaw: signal.amount,
        maxTradeAmount: this.config.maxTradeAmount,
        slippage: this.config.slippage,
      });
    }

    const entryPx =
      entryPriceUsdHint != null &&
      Number.isFinite(entryPriceUsdHint) &&
      entryPriceUsdHint > 0
        ? entryPriceUsdHint
        : await this.resolveRefPriceUsd(signal);
    if (entryPx == null || entryPx <= 0) {
      return {
        ok: false,
        mode: "live",
        reason: "no_entry_price_for_live_sizing",
      };
    }

    const stop =
      signal.type === "BUY"
        ? entryPx * (1 - this.config.stopLossPct)
        : entryPx * (1 + this.config.stopLossPct);
    const tokenSize = this.computePositionSize(entryPx, stop);
    if (!Number.isFinite(tokenSize) || tokenSize <= 0) {
      return {
        ok: false,
        mode: "live",
        reason: "invalid_position_size",
      };
    }

    let maxTradeAmountForExec: number;
    if (signal.type === "BUY") {
      let ethUsd: number;
      try {
        ethUsd = await this.marketService.getLatestPrice();
      } catch {
        return {
          ok: false,
          mode: "live",
          reason: "eth_usd_price_unavailable",
        };
      }
      if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
        return {
          ok: false,
          mode: "live",
          reason: "eth_usd_price_invalid",
        };
      }
      const notionalUsd = tokenSize * entryPx;
      maxTradeAmountForExec = notionalUsd / ethUsd;
    } else {
      maxTradeAmountForExec = tokenSize;
    }

    if (!Number.isFinite(maxTradeAmountForExec) || maxTradeAmountForExec <= 0) {
      return {
        ok: false,
        mode: "live",
        reason: "invalid_live_amount_in",
      };
    }

    return this.executionService.execute({
      mode: "live",
      tokenIn,
      tokenOut,
      amountInRaw: signal.amount,
      maxTradeAmount: maxTradeAmountForExec,
      slippage: this.config.slippage,
    });
  }

  private canEnterFromExecutionResult(result: ExecuteResult): boolean {
    return (
      result.ok &&
      (result.mode === "paper" || (result.mode === "live" && Boolean(result.txHash)))
    );
  }

  private applyExecutionResult(
    result: ExecuteResult,
    signal: CopierSignalPayload,
  ): void {
    const execData: Record<string, unknown> = !result.ok
      ? { reason: result.reason }
      : result.debug
        ? {
            amountIn: result.debug.amountIn,
            amountOut: result.debug.quoteAmountOut,
            minOut: result.debug.minOut,
            slippage: result.debug.slippage,
          }
        : { mode: result.mode };
    const canEnterPosition = this.canEnterFromExecutionResult(result);
    const liveWithoutTxHash = result.ok && result.mode === "live" && !result.txHash;
    void this.dbHooks?.onExecutionEvent?.({
      ok: canEnterPosition,
      mode: result.mode,
      reason: canEnterPosition
        ? undefined
        : liveWithoutTxHash
          ? "live_tx_missing"
          : !result.ok
            ? result.reason
            : undefined,
      txHash:
        result.mode === "live" && result.ok && result.txHash ? result.txHash : undefined,
      data: execData,
    });
    if (!canEnterPosition) {
      this.executionPending = false;
      this.executionReady = false;
      this.executionFailReason = liveWithoutTxHash
        ? "live_tx_missing"
        : !result.ok
          ? result.reason
          : "unknown";
      this.emitEv(
        "ERROR",
        liveWithoutTxHash
          ? "Execution failed: live_tx_missing"
          : !result.ok
            ? `Execution failed: ${result.reason}`
            : "Execution failed: unknown",
      );
      return;
    }
    this.executionPending = false;
    this.executionReady = true;
    this.executionFailReason = null;
    if (result.ok && result.mode === "live" && result.txHash) {
      const quoteInfo = result.debug
        ? `amountIn=${result.debug.amountIn} quoteOut=${result.debug.quoteAmountOut} minOut=${result.debug.minOut} slippage=${result.debug.slippage}`
        : "quote=na";
      this.emitEv("EXECUTION", `Live tx sent: ${result.txHash} | ${quoteInfo}`);
    }
  }

  /** Quoter 隐含 USD/代币 vs Dexscreener spot 的相对偏差（0–1）。 */
  private async computeQuoteVsDexDeviationPct(
    tokenUsd: number,
    direction: "BUY" | "SELL",
  ): Promise<number> {
    if (!Number.isFinite(tokenUsd) || tokenUsd <= 0) {
      throw new Error("invalid_token_usd");
    }
    const wrapped = CHAINS.arb.wrappedNative.address;
    const dec = await this.marketService.getErc20Decimals(this.token);
    const ethUsd = await this.marketService.getLatestPrice();
    const fee = 3000;

    if (direction === "BUY") {
      const probe = 10n ** 15n;
      const out = await this.quoterService.quoteExactInputSingle({
        tokenIn: wrapped,
        tokenOut: this.token,
        fee,
        amountIn: probe,
      });
      const ethSpent = Number(probe) / 1e18;
      const tok = Number(out) / 10 ** dec;
      if (tok <= 0) throw new Error("quote_zero_out");
      const impliedUsd = (ethSpent * ethUsd) / tok;
      return Math.abs(impliedUsd - tokenUsd) / tokenUsd;
    }

    const probeTok = parseUnits("0.001", dec);
    const outWeth = await this.quoterService.quoteExactInputSingle({
      tokenIn: this.token,
      tokenOut: wrapped,
      fee,
      amountIn: probeTok,
    });
    const tokHuman = Number(probeTok) / 10 ** dec;
    const wethOut = Number(outWeth) / 1e18;
    if (tokHuman <= 0) throw new Error("invalid_probe");
    const impliedUsd = (wethOut * ethUsd) / tokHuman;
    return Math.abs(impliedUsd - tokenUsd) / tokenUsd;
  }

  /** 多单：max(当前止损, curPrice − ATR×k)；空单：min(当前止损, curPrice + ATR×k)。 */
  private async maybeApplyAtrTrailingStop(
    pos: Position,
    livePrice: number,
  ): Promise<Position | null> {
    if (this.config.trailingStopMode !== "atr") {
      return null;
    }
    const mult = this.config.trailingStopAtrMultiple;
    const period = this.config.trailingStopAtrPeriod;
    if (!Number.isFinite(mult) || mult <= 0 || !Number.isFinite(period) || period < 2) {
      return null;
    }
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      return null;
    }
    const limit = Math.min(120, Math.max(period + 5, 50));
    let candles: MarketCandle[];
    try {
      candles = await this.marketService.getDexscreenerChartCandlesForArbitrum(
        this.token,
        limit,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ATR trailing: chart fetch failed: ${msg}`);
      return null;
    }
    const endIdx = candles.length - 1;
    const atr = computeAtrSimpleAvgHighLow(candles, endIdx, period);
    if (atr == null || !Number.isFinite(atr) || atr <= 0) {
      return null;
    }
    const band = atr * mult;
    let nextStop: number;
    if (pos.side === "LONG") {
      nextStop = Math.max(pos.stopLoss, livePrice - band);
    } else {
      nextStop = Math.min(pos.stopLoss, livePrice + band);
    }
    const scale = Math.max(1, Math.abs(pos.stopLoss));
    if (Math.abs(nextStop - pos.stopLoss) <= 1e-12 * scale) {
      return null;
    }
    return { ...pos, stopLoss: nextStop };
  }

  private syncOpenTradeStopLoss(newStop: number): void {
    const trades = this.stateStore.getTrades();
    for (let i = trades.length - 1; i >= 0; i--) {
      const t = trades[i]!;
      if (t.status === "OPEN" && t.token === this.token) {
        this.stateStore.updateTrade(t.id, { stopLoss: newStop });
        return;
      }
    }
  }

  private enterInPositionAtPrice(
    entryPrice: number,
    sigType: "BUY" | "SELL",
    tSec: number,
  ): void {
    if (sigType === "BUY") {
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
    this.emitEv("ENTRY", `${sigType} @ ${entryPrice}`, { side: opened?.side }, entryPrice);
    if (opened) {
      const tradeId = createEntityId();
      this.stateStore.addTrade({
        id: tradeId,
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
      void this.dbHooks?.onTradeOpen?.({
        tradeId,
        address: this.address,
        token: this.token,
        side: opened.side,
        size: opened.size,
        entryPrice: opened.entryPrice,
      });
    }
    this.executionPending = false;
    this.executionReady = false;
    this.executionFailReason = null;
    this.state = "IN_POSITION";
  }

  /** 单次调度：拉取价格并推进状态机一步。 */
  async onTick(): Promise<void> {
    if (!this.running) return;

    let livePrice: number;
    try {
      livePrice = await this.marketService.getLatestPriceByToken(this.token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`getLatestPriceByToken failed: ${msg}`);
      this.emitEv("ERROR", msg);
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
            /* 预留：AUTO 模式下的 IDLE 分支逻辑 */
          }
          break;
        }
        case "WAITING_ENTRY": {
          if (this.pendingOrder && this.pendingExecutionSignal) {
            if (Date.now() > this.pendingOrder.expireAt) {
              const ep = this.pendingOrder.entryPrice;
              this.releaseReservationTracked();
              this.clearFvgPending();
              this.stateStore.setSignal(null);
              this.pendingSignalTick = null;
              this.state = "IDLE";
              this.emitEv("ORDER_EXPIRED", "FVG pending order timeout", {
                entryPrice: ep,
              });
              break;
            }

            const { entryPrice, direction } = this.pendingOrder;
            const hit =
              direction === "BUY"
                ? livePrice <= entryPrice
                : livePrice >= entryPrice;
            if (!hit) {
              break;
            }

            this.emitEv("ORDER_TRIGGERED", "Price touched FVG entry (wait path)", {
              entryPrice,
              spot: livePrice,
              direction,
            });

            const sig = this.pendingExecutionSignal;
            this.clearFvgPending();
            this.stateStore.setSignal(null);
            this.pendingSignalTick = null;

            try {
              this.executionPending = true;
              this.executionReady = false;
              this.executionFailReason = null;
              const result = await this.runExecution(sig, livePrice);
              this.applyExecutionResult(result, sig);
              if (this.canEnterFromExecutionResult(result)) {
                this.enterInPositionAtPrice(livePrice, sig.type, tSec);
              } else {
                this.state = "IDLE";
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.emitEv("ERROR", `FVG wait execution crashed: ${msg}`);
              this.state = "IDLE";
            } finally {
              this.executionPending = false;
              this.releaseReservationTracked();
            }
            break;
          }

          const pendingSignal = this.stateStore.getSignal();
          if (!pendingSignal) {
            this.state = "IDLE";
            break;
          }
          if (this.mode !== "MANUAL") break;
          if (this.executionPending) {
            break;
          }
          if (this.executionFailReason) {
            this.stateStore.setSignal(null);
            this.pendingSignalTick = null;
            this.executionReady = false;
            this.state = "IDLE";
            break;
          }
          if (!this.executionReady) {
            break;
          }
          if (
            this.config.entryMode === "delayed" &&
            this.pendingSignalTick !== null &&
            this.tickCount <= this.pendingSignalTick
          ) {
            break;
          }

          const entryPx = livePrice;
          const sig = pendingSignal;

          if (sig.type === "BUY") {
            const stopLoss = entryPx * (1 - this.config.stopLossPct);
            const takeProfit = entryPx * (1 + this.config.takeProfitPct);
            const size = this.computePositionSize(entryPx, stopLoss);
            this.stateStore.setPosition({
              id: createEntityId(),
              token: this.token,
              side: "LONG",
              entryTime: tSec,
              entryPrice: entryPx,
              size,
              stopLoss,
              takeProfit,
              status: "OPEN",
            });
          } else {
            const stopLoss = entryPx * (1 + this.config.stopLossPct);
            const takeProfit = entryPx * (1 - this.config.takeProfitPct);
            const size = this.computePositionSize(entryPx, stopLoss);
            this.stateStore.setPosition({
              id: createEntityId(),
              token: this.token,
              side: "SHORT",
              entryTime: tSec,
              entryPrice: entryPx,
              size,
              stopLoss,
              takeProfit,
              status: "OPEN",
            });
          }

          const opened = this.stateStore.getPosition();
          this.emitEv("ENTRY", `${sig.type} @ market (${opened?.side})`, undefined, entryPx);
          if (opened) {
            const tradeId = createEntityId();
            this.stateStore.addTrade({
              id: tradeId,
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
            void this.dbHooks?.onTradeOpen?.({
              tradeId,
              address: this.address,
              token: this.token,
              side: opened.side,
              size: opened.size,
              entryPrice: opened.entryPrice,
            });
          }
          this.stateStore.setSignal(null);
          this.pendingSignalTick = null;
          this.executionPending = false;
          this.executionReady = false;
          this.executionFailReason = null;
          this.state = "IN_POSITION";
          break;
        }
        case "IN_POSITION": {
          let pos = this.stateStore.getPosition();
          if (!pos) {
            this.state = "IDLE";
            break;
          }

          const trailed = await this.maybeApplyAtrTrailingStop(pos, livePrice);
          if (trailed) {
            this.stateStore.setPosition(trailed);
            this.syncOpenTradeStopLoss(trailed.stopLoss);
            pos = trailed;
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
      this.emitEv(
        "ERROR",
        `Engine tick crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
    this.emitEv("EXIT", `${reason} (${pos.side})`, undefined, exitPrice);
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
      void this.dbHooks?.onTradeClose?.({
        tradeId: openTrade.id,
        exitPrice,
        pnl,
      });
    } else {
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

  /** 用于预占与仓位计算的现货参考价（USD/枚）。 */
  private async resolveRefPriceUsd(
    signal: CopierSignalPayload,
  ): Promise<number | null> {
    const p = signal.price ?? this.currentPrice;
    if (Number.isFinite(p) && p != null && p > 0) {
      return p;
    }
    try {
      const px = await this.marketService.getLatestPriceByToken(this.token);
      return Number.isFinite(px) && px > 0 ? px : null;
    } catch {
      return null;
    }
  }

  private computePositionSize(entryPrice: number, stopLoss: number): number {
    const equity = this.config.accountEquityUsdt;
    if (!Number.isFinite(equity) || equity <= 0) {
      return 0;
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return 0;
    }

    const cap = Number(this.config.maxTradeAmount);
    const applyCap = (size: number): number => {
      if (!Number.isFinite(cap) || cap < 0) {
        return size;
      }
      return Math.min(size, cap);
    };

    if (this.config.positionSizingMode === "fixed_equity_percent") {
      const pct = this.config.orderEquityPercent;
      if (!Number.isFinite(pct) || pct <= 0) {
        return 0;
      }
      const notionalUsd = equity * pct;
      const size = notionalUsd / entryPrice;
      return applyCap(size);
    }

    const riskAmount = equity * this.config.riskPerTrade;
    const stopLossDistance = Math.abs(entryPrice - stopLoss);
    if (!Number.isFinite(stopLossDistance) || stopLossDistance <= 0) {
      return 0;
    }
    const riskBasedSize = riskAmount / stopLossDistance;
    return applyCap(riskBasedSize);
  }
}
