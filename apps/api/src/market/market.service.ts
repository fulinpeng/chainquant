import { BadRequestException, Injectable } from "@nestjs/common";
import * as path from "path";

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

/** 以太坊主网 WETH 地址 — MVP 下用于 Dexscreener 现价查询的写死常量。 */
const DEXSCREENER_ETH_TOKEN =
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

type DexscreenerPair = {
  chainId?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
};

type DexscreenerTokenResponse = {
  pairs?: DexscreenerPair[];
};

/** 忽略分叉链上复用 WETH 地址、价格接近 0 的假池子。 */
const PREFERRED_CHAIN = "ethereum";
/** ETH 现价应远高于此值（美元），用于过滤异常报价。 */
const MIN_SANE_PRICE_USD = 100;

let cachedDataset: MarketDataset | null = null;

function loadDataset(): MarketDataset {
  if (cachedDataset) return cachedDataset;

  // 本地 K 线数据文件为 CommonJS 的 `module.exports`。
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
  private pickBestDexPrice(pairs: DexscreenerPair[]): number {
    const mainnet = pairs.filter(
      (p) => (p.chainId ?? "").toLowerCase() === PREFERRED_CHAIN,
    );
    const candidates = mainnet.length > 0 ? mainnet : pairs;

    const scored = candidates
      .map((p) => {
        const raw = p.priceUsd;
        if (raw === undefined || raw === null) return null;
        const n = Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n) || n < MIN_SANE_PRICE_USD) return null;
        const liq = Number(p.liquidity?.usd ?? 0);
        const vol = Number(p.volume?.h24 ?? 0);
        const score = liq * 2 + vol;
        return { price: n, score };
      })
      .filter((x): x is { price: number; score: number } => x !== null);

    if (scored.length === 0) {
      throw new BadRequestException(
        "Dexscreener: no liquid Ethereum mainnet pair with sane priceUsd",
      );
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0].price;
  }

  /**
   * 从 Dexscreener 获取代币 USD 现价（MVP：内部固定为 ETH/WETH）。
   */
  async getLatestPrice(): Promise<number> {
    return this.getLatestPriceByToken(DEXSCREENER_ETH_TOKEN);
  }

  /**
   * 从 Dexscreener 按合约地址查询该 ERC20 的 USD 现价。
   */
  async getLatestPriceByToken(tokenAddress: string): Promise<number> {
    const token = (tokenAddress ?? "").trim();
    if (!token) {
      throw new BadRequestException("tokenAddress is required");
    }

    const url = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
    let res: Response;
    try {
      res = await fetch(url, { method: "GET" });
    } catch {
      throw new BadRequestException("Dexscreener request failed (network)");
    }

    if (!res.ok) {
      throw new BadRequestException(
        `Dexscreener request failed (${res.status})`,
      );
    }

    const data = (await res.json()) as DexscreenerTokenResponse;
    const pairs = data.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0) {
      throw new BadRequestException("Dexscreener returned no pairs for token");
    }
    return this.pickBestDexPrice(pairs);
  }

  getCandles(params: {
    symbol: string;
    interval: string;
    limit: number;
  }): MarketCandle[] {
    const symbol = (params.symbol ?? "").toLowerCase().trim();
    const interval = (params.interval ?? "").toLowerCase().trim();

    // MVP：仅支持一份本地数据集文件。
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

