import { Injectable } from "@nestjs/common";

export type EventType =
  | "SIGNAL"
  | "ENTRY"
  | "EXIT"
  | "STOP"
  | "ERROR_FETCH_PRICE"
  | "INVALID_SIGNAL"
  | "COOLDOWN_BLOCK";

export type EngineEventRecord = {
  type: EventType;
  timestamp: number;
  price?: number;
  message?: string;
};

const MAX_EVENTS = 100;

@Injectable()
export class EventService {
  private readonly events: EngineEventRecord[] = [];

  addEvent(
    event: Omit<EngineEventRecord, "timestamp"> & { timestamp?: number },
  ): void {
    const record: EngineEventRecord = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };
    this.events.push(record);
    if (this.events.length > MAX_EVENTS) {
      const drop = this.events.length - MAX_EVENTS;
      this.events.splice(0, drop);
    }
  }

  getRecentEvents(limit: number): EngineEventRecord[] {
    const n = Math.min(Math.max(1, limit), MAX_EVENTS);
    if (this.events.length <= n) {
      return [...this.events];
    }
    return this.events.slice(-n);
  }
}
