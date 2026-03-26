import type { TradeSide } from "./trade";

export type Position = {
  id: string;
  token: string;
  side: TradeSide;
  entryTime: number;
  entryPrice: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
  status: "OPEN";
};
