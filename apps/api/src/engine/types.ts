import type { Position } from "../domain/position";
import type { Trade } from "../domain/trade";

export type EngineMode = "MANUAL" | "AUTO";

export type EngineRuntimeConfig = {
  riskPerTrade: number;
  stopLossPct: number;
  takeProfitPct: number;
  delayEntry: boolean;
  maxPositions: number;
  mode: "paper" | "live";
  maxTradeAmount: number;
  slippage: number;
  /**
   * 链上解析到的该笔 swap 名义价值（按 USD / USDT 计价）低于此值则忽略信号。
   * `0` 表示不筛选。
   */
  minSignalNotionalUsdt: number;
};

export const DEFAULT_ENGINE_RUNTIME_CONFIG: EngineRuntimeConfig = {
  riskPerTrade: 0.01,
  stopLossPct: 0.0001, // 1/10000
  takeProfitPct: 0.0002, // 2/10000
  delayEntry: false,
  maxPositions: 1,
  mode: "paper",
  maxTradeAmount: 0.01,
  slippage: 0.005,
  minSignalNotionalUsdt: 0,
};

export type CopierSignalPayload = {
  type: "BUY" | "SELL";
  /** 外部观测价格（测试/手动入场时可选）。 */
  price?: number;
  /** 链上解析得到的原始数量（整数字符串）。 */
  amount?: string;
  /** 来源链标识（可选）。 */
  chain?: string;
};

/** 旁路数据库回调；由 EngineManager 注入，失败不影响引擎。 */
export type EngineDbHooks = {
  onTradeOpen?: (input: {
    tradeId: string;
    address: string;
    token: string;
    side: "LONG" | "SHORT";
    size: number;
    entryPrice: number;
  }) => void | Promise<void>;
  onTradeClose?: (input: {
    tradeId: string;
    exitPrice: number;
    pnl: number;
  }) => void | Promise<void>;
  onExecutionEvent?: (input: {
    ok: boolean;
    mode: "paper" | "live";
    reason?: string;
    txHash?: string;
    /** 写入 Event.data，供分析（如 amountIn / slippage）。 */
    data?: Record<string, unknown> | null;
  }) => void | Promise<void>;
};

export type EngineState = "IDLE" | "WAITING_ENTRY" | "IN_POSITION";

export type EngineStatusDto = {
  running: boolean;
  mode: EngineMode;
  state: EngineState;
  /** 跟单维度：钱包地址（多实例键）。 */
  address: string;
  /** 交易标的代币合约（多实例键）。 */
  token: string;
  currentPrice: number | null;
  entryPrice: number | null;
  pendingSignalType: "BUY" | "SELL" | null;
  position: Position | null;
  tickCount: number;
  lastUpdateTime: number;
  lastExitTick: number | null;
  cooldownCandles: number;
  cooldownTicksRemaining: number;
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

/** 平仓后需再经历的 tick 数，之后才接受新信号（近似 K 线根数）。 */
export const COOLDOWN_CANDLES = 10;

export const ENGINE_TICK_MS = 2000;
