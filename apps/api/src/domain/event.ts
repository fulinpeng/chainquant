export type EventType =
  | "SIGNAL"
  | "EXECUTION"
  | "ENTRY"
  | "EXIT"
  | "INVALID_SIGNAL"
  | "COOLDOWN_BLOCK"
  | "ERROR"
  | "FVG_REJECTED"
  | "RESERVATION_FAILED"
  | "ORDER_PLACED"
  | "ORDER_TRIGGERED"
  | "ORDER_EXPIRED";

export type EngineEvent = {
  id: string;
  type: EventType;
  timestamp: number;
  price?: number;
  message?: string;
  /** 结构化回放字段（可选） */
  data?: Record<string, unknown>;
};
