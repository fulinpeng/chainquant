import { Injectable } from "@nestjs/common";
import { createEntityId } from "../domain/id";
import type { EngineEvent, EventType } from "../domain/event";
import type { Position } from "../domain/position";
import type { Signal } from "../domain/signal";
import type { Trade } from "../domain/trade";

const MAX_EVENTS = 100;

export type AddEngineEventInput = {
  type: EventType;
  timestamp?: number;
  price?: number;
  message?: string;
};

@Injectable()
export class StateStore {
  private position: Position | null = null;
  private trades: Trade[] = [];
  private events: EngineEvent[] = [];
  private pendingSignal: Signal | null = null;

  getPosition(): Position | null {
    return this.position;
  }

  setPosition(next: Position | null): void {
    this.position = next;
  }

  getTrades(): Trade[] {
    return [...this.trades];
  }

  addTrade(trade: Trade): void {
    this.trades.push(trade);
  }

  updateTrade(tradeId: string, patch: Partial<Trade>): void {
    const idx = this.trades.findIndex((t) => t.id === tradeId);
    if (idx < 0) return;
    this.trades[idx] = {
      ...this.trades[idx],
      ...patch,
    };
  }

  clearTrades(): void {
    this.trades = [];
  }

  getEvents(): EngineEvent[] {
    return [...this.events];
  }

  addEvent(input: AddEngineEventInput): void {
    const record: EngineEvent = {
      id: createEntityId(),
      type: input.type,
      timestamp: input.timestamp ?? Date.now(),
      price: input.price,
      message: input.message,
    };
    this.events.push(record);
    if (this.events.length > MAX_EVENTS) {
      const drop = this.events.length - MAX_EVENTS;
      this.events.splice(0, drop);
    }
  }

  getSignal(): Signal | null {
    return this.pendingSignal;
  }

  setSignal(next: Signal | null): void {
    this.pendingSignal = next;
  }

  /** Clears position, pending signal, and trade history (events retained). */
  resetTradingState(): void {
    this.position = null;
    this.pendingSignal = null;
    this.trades = [];
  }
}
