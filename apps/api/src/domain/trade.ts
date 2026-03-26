export type TradeSide = "LONG" | "SHORT";

export type Trade = {
  id: string;
  token: string;
  side: TradeSide;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  status: "CLOSED";
};
