export type SignalType = "BUY" | "SELL";

export type Signal = {
  id: string;
  token: string;
  type: SignalType;
  price: number;
  createdAt: number;
};
