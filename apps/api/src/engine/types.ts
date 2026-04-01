import type { Position } from "../domain/position";
import type { Trade } from "../domain/trade";

export type EngineMode = "MANUAL" | "AUTO";

/**
 * 入场模式：
 * - immediate：验证通过后立即执行并在 tick 入场；
 * - delayed：验证通过后仍走非 FVG 链路，但执行就绪后至少再等 1 个引擎 tick 再入场；
 * - pullback：FVG 校验后等价格触达再执行（entryTimeoutMs）。
 */
export type EntryMode = "immediate" | "delayed" | "pullback";

/** 移动止损模式；后续可扩展，目前仅 `atr`。 */
export type TrailingStopMode = "off" | "atr";

/**
 * 仓位名义计算方式：
 * - risk_from_stop：按权益 × riskPerTrade 为风险预算，除以入场与止损价距离得数量（以损订仓）；
 * - fixed_equity_percent：单笔名义 = 权益 × orderEquityPercent，再换算为代币数量。
 */
export type PositionSizingMode = "risk_from_stop" | "fixed_equity_percent";

export type EngineRuntimeConfig = {
  /** 账户权益名义（USD/USDT），用于模拟仓位、预占与 sizing */
  accountEquityUsdt: number;
  positionSizingMode: PositionSizingMode;
  /**
   * 仅 `fixed_equity_percent`：每笔订单目标名义占权益比例（0–1），如 0.05 = 5%。
   */
  orderEquityPercent: number;
  riskPerTrade: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositions: number;
  mode: "paper" | "live";
  maxTradeAmount: number;
  slippage: number;
  /**
   * 链上解析到的该笔 swap 名义价值（按 USD / USDT 计价）低于此值则忽略信号。
   * `0` 表示不筛选。
   */
  minSignalNotionalUsdt: number;
  /** 回调入场模式下，挂单等待触价的最长时间（毫秒），默认 15 分钟 */
  entryTimeoutMs: number;
  entryMode: EntryMode;
  /** 移动止损：关闭，或按 ATR（与 {@link trailingStopAtrMultiple} / {@link trailingStopAtrPeriod} 配合） */
  trailingStopMode: TrailingStopMode;
  /** ATR 倍数；仅 `trailingStopMode === "atr"` 时生效 */
  trailingStopAtrMultiple: number;
  /** 计算 ATR 所用 K 线根数（Dexscreener chart），默认 14 */
  trailingStopAtrPeriod: number;
};

export const DEFAULT_ENGINE_RUNTIME_CONFIG: EngineRuntimeConfig = {
  accountEquityUsdt: 10_000,
  positionSizingMode: "risk_from_stop",
  orderEquityPercent: 0.05,
  riskPerTrade: 0.01,
  stopLossPct: 0.0001, // 1/10000
  takeProfitPct: 0.0002, // 2/10000
  maxPositions: 1,
  mode: "paper",
  maxTradeAmount: 0.01,
  slippage: 0.005,
  minSignalNotionalUsdt: 0,
  entryTimeoutMs: 900_000,
  entryMode: "pullback",
  trailingStopMode: "off",
  trailingStopAtrMultiple: 3,
  trailingStopAtrPeriod: 14,
};

/** 兼容旧存盘：仅有 fvgEnabled / delayEntry 或 immediate+delayEntry 组合时推导 entryMode */
export function coerceEntryMode(
  input: Partial<EngineRuntimeConfig> & {
    fvgEnabled?: boolean;
    delayEntry?: boolean;
  },
): EntryMode {
  const em = input.entryMode;
  if (em === "delayed" || em === "pullback") {
    return em;
  }
  if (em === "immediate") {
    return input.delayEntry === true ? "delayed" : "immediate";
  }
  if (input.fvgEnabled === false) {
    return input.delayEntry === true ? "delayed" : "immediate";
  }
  return DEFAULT_ENGINE_RUNTIME_CONFIG.entryMode;
}

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
