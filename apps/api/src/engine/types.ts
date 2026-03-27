import type { Position } from "../domain/position";
import type { Trade } from "../domain/trade";

export type EngineMode = "MANUAL" | "AUTO";

export type EngineRuntimeConfig = {
  riskPerTrade: number;
  stopLossPct: number;
  takeProfitPct: number;
  delayEntry: boolean;
  maxPositions: number;
};

export const DEFAULT_ENGINE_RUNTIME_CONFIG: EngineRuntimeConfig = {
  riskPerTrade: 0.01,
  stopLossPct: 0.0001, // 1/10000
  takeProfitPct: 0.0002, // 2/10000
  delayEntry: false,
  maxPositions: 1,
};

export type CopierSignalPayload = {
  type: "BUY" | "SELL";
  /** Optional external observed price for test/manual entry. */
  price?: number;
};

export type EngineState = "IDLE" | "WAITING_ENTRY" | "IN_POSITION";

export type EngineStatusDto = {
  running: boolean;
  mode: EngineMode;
  state: EngineState;
  /** Copier / wallet dimension (multi-instance key). */
  address: string;
  /** Traded token contract (multi-instance key). */
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

/** Min ticks after EXIT before accepting a new signal (proxy for "candles"). */
export const COOLDOWN_CANDLES = 10;

export const ENGINE_TICK_MS = 2000;
