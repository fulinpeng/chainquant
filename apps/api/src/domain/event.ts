export type EventType =
  | "SIGNAL"
  | "EXECUTION"
  | "ENTRY"
  | "EXIT"
  | "INVALID_SIGNAL"
  | "COOLDOWN_BLOCK"
  | "ERROR";

export type EngineEvent = {
  id: string;
  type: EventType;
  timestamp: number;
  price?: number;
  message?: string;
};
