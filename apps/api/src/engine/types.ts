import type { Position } from "../domain/position";
import type { Trade } from "../domain/trade";

export type EngineMode = "MANUAL" | "AUTO";

export type CopierSignalPayload = {
  type: "BUY" | "SELL";
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
