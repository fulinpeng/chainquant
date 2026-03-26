export type TradeSide = "LONG" | "SHORT";

export type Trade = {
  id: string;
  token: string;
  side: TradeSide;
  entryTime: number;
  entryPrice: number;
  size: number;
  exitTime: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  pnl: number | null;
  status: "OPEN" | "CLOSED";
};
