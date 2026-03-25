import { BadRequestException, Injectable } from "@nestjs/common";
import path from "path";

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type KLineRow = {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type MarketDataset = {
  kLineData: KLineRow[];
};

const DATA_FILE_PATH = path.resolve(__dirname, "../../data/ethUSDT-4h.js");

let cachedDataset: MarketDataset | null = null;

function loadDataset(): MarketDataset {
  if (cachedDataset) return cachedDataset;

  // The local dataset file uses CommonJS `module.exports`.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(DATA_FILE_PATH) as MarketDataset;
  if (!mod || !Array.isArray(mod.kLineData)) {
    throw new BadRequestException("Market dataset file is invalid");
  }

  cachedDataset = mod;
  return cachedDataset;
}

function parseOpenTimeToUnixSeconds(openTime: string): number {
  const input = openTime ?? "";
  const m = input.match(
    /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/,
  );
  if (!m) throw new BadRequestException("Invalid openTime format in dataset");

  const [_, datePart, hh, mm, ss] = m;
  const [y, mo, d] = datePart.split("-").map((x) => Number(x));

  const yNum = Number(y);
  const moNum = Number(mo);
  const dNum = Number(d);
  const hhNum = Number(hh);
  const mmNum = Number(mm);
  const ssNum = Number(ss);

  const timeMs = Date.UTC(yNum, moNum - 1, dNum, hhNum, mmNum, ssNum);
  if (!Number.isFinite(timeMs)) {
    throw new BadRequestException("Failed to parse openTime");
  }

  return Math.floor(timeMs / 1000);
}

@Injectable()
export class MarketService {
  getCandles(params: {
    symbol: string;
    interval: string;
    limit: number;
  }): MarketCandle[] {
    const symbol = (params.symbol ?? "").toLowerCase().trim();
    const interval = (params.interval ?? "").toLowerCase().trim();

    // MVP: only one dataset file is supported.
    if (symbol !== "eth") {
      throw new BadRequestException("Unsupported symbol for MVP");
    }
    if (interval !== "4h") {
      throw new BadRequestException("Unsupported interval for MVP");
    }

    const limit = Math.min(Math.max(1, params.limit ?? 10000), 10000);

    const dataset = loadDataset();
    const rows = dataset.kLineData;
    if (!rows.length) return [];

    const start = Math.max(0, rows.length - limit);
    const slice = rows.slice(start);

    return slice.map((row) => ({
      time: parseOpenTimeToUnixSeconds(row.openTime),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }
}

