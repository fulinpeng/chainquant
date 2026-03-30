import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Contract, getAddress, WebSocketProvider } from "ethers";
import { EngineManager } from "../engine/engine.manager";
import type { EngineRuntimeConfig } from "../engine/types";
import { MarketService } from "../market/market.service";
import { ParserService, type ParsedSwap } from "./parser.service";
import { CHAINS, type ChainKey } from "../config/chains";

type ActiveWatcherSnapshot = {
  address: string;
  chain: ChainKey;
  status: "RUNNING" | "STOPPED";
  config: EngineRuntimeConfig;
};

@Injectable()
export class ListenerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ListenerService.name);
  private readonly providers = new Map<ChainKey, WebSocketProvider>();
  private readonly activeWatchers = new Map<string, ActiveWatcherSnapshot>();
  private readonly tokenDecimalsCache = new Map<string, number>();
  private started = false;

  constructor(
    private readonly engineManager: EngineManager,
    private readonly parserService: ParserService,
    private readonly marketService: MarketService,
  ) {}

  onModuleInit() {}

  onApplicationBootstrap() {
    this.start();
  }

  async onModuleDestroy() {
    for (const provider of this.providers.values()) {
      try {
        await provider.destroy();
      } catch {
        // 忽略销毁错误
      }
    }
    this.providers.clear();
    this.started = false;
  }

  upsertWatcher(watcher: ActiveWatcherSnapshot): { ok: true } {
    const key = this.makeWatcherKey(watcher.address, watcher.chain);
    if (watcher.status === "RUNNING") {
      this.activeWatchers.set(key, {
        ...watcher,
        address: watcher.address.toLowerCase(),
      });
    } else {
      this.activeWatchers.delete(key);
    }
    return { ok: true };
  }

  removeWatcher(address: string, chain?: ChainKey): { ok: true } {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) return { ok: true };
    if (chain) {
      this.activeWatchers.delete(this.makeWatcherKey(normalized, chain));
      return { ok: true };
    }
    for (const k of [...this.activeWatchers.keys()]) {
      if (k.startsWith(`${normalized}_`)) {
        this.activeWatchers.delete(k);
      }
    }
    return { ok: true };
  }

  async replayTx(input: { txHash: string; chain?: ChainKey }) {
    const txHash = (input.txHash ?? "").trim().toLowerCase();
    const chainKey = (input.chain ?? "arb") as ChainKey;
    if (!txHash) {
      throw new BadRequestException("txHash is required");
    }

    const provider = this.providers.get(chainKey);
    if (!provider) {
      throw new BadRequestException(`listener not started for chain=${chainKey}`);
    }

    try {
      const tx = await this.withRetryOn429(
        () =>
          this.withTimeout(
            provider.getTransaction(txHash),
            12000,
            "getTransaction timeout",
          ),
        3,
      );
      if (!tx) {
        throw new BadRequestException(`tx not found: ${txHash}`);
      }

      const result = await this.withRetryOn429(
        () =>
          this.withTimeout(
            this.processWatchedTx(chainKey, provider, txHash, {
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              data: tx.data,
            }),
            18000,
            "processWatchedTx timeout",
          ),
        2,
      );

      return {
        ok: Boolean(result && result.hit),
        chain: chainKey,
        txHash,
        ...result,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[replay-tx] failed for ${txHash} on ${chainKey}: ${msg}`);
      return {
        ok: false,
        chain: chainKey,
        txHash,
        hit: false as const,
        reason: "rpc_error",
        message: msg,
      };
    }
  }

  private start() {
    if (this.started) return;
    this.started = true;

    const entries = Object.entries(CHAINS) as Array<[ChainKey, (typeof CHAINS)[ChainKey]]>;
    for (const [chainKey, cfg] of entries) {
      if (!cfg.enabled) {
        this.logger.log(`[${cfg.name}] skipped by config (enabled=false)`);
        continue;
      }
      const wsUrl = (process.env[cfg.wsUrlEnv] ?? "").trim();
      if (!wsUrl) {
        this.logger.warn(`[${cfg.name}] ${cfg.wsUrlEnv} not set; skip listener`);
        continue;
      }

      const provider = new WebSocketProvider(wsUrl);
      this.providers.set(chainKey, provider);

      provider.on("block", (blockNumber) => {
        void this.handleBlock(chainKey, provider, blockNumber);
      });

      this.logger.log(`Chain listener started (${cfg.name})`);
    }

    if (this.providers.size === 0) {
      this.logger.warn("No WS providers configured; chain listener disabled");
    }
  }

  private async handleBlock(
    chainKey: ChainKey,
    provider: WebSocketProvider,
    blockNumber: number,
  ): Promise<void> {
    try {
      // 一次请求拉取带完整交易的区块，避免按笔交易分散 RPC。
      const block = await provider.getBlock(blockNumber, true);
      const txs = block?.transactions ?? [];
      for (const txItem of txs) {
        const tx = typeof txItem === "string"
          ? await provider.getTransaction(txItem)
          : (txItem as {
              hash: string;
              from?: string | null;
              to?: string | null;
              data?: string | null;
            });
        if (!tx) continue;
        await this.processWatchedTx(chainKey, provider, tx.hash, tx);
      }
    } catch (err) {
      this.logger.warn(
        `[${chainKey}] Block handling failed(${blockNumber}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async processWatchedTx(
    chainKey: ChainKey,
    provider: WebSocketProvider,
    txHash: string,
    tx: {
      hash: string;
      from?: string | null;
      to?: string | null;
      data?: string | null;
    },
  ): Promise<
    | {
        hit: false;
        reason: string;
      }
    | {
        hit: true;
        from: string;
        token: string;
        side: "BUY" | "SELL";
      }
  > {
    const from = (tx.from ?? "").toLowerCase();
    const watcher = this.getActiveWatcher(from, chainKey);
    if (!watcher) {
      return { hit: false, reason: "address_not_watched" };
    }

    const chainCfg = CHAINS[chainKey];
    const toLower = (tx.to ?? "").toLowerCase();
    const isV4UniversalRouter = chainCfg.v4UniversalRouters.includes(toLower);

    const parsed = isV4UniversalRouter
      ? await (async () => {
          const receipt = await provider.getTransactionReceipt(txHash);
          return this.parserService.parseSwapTx(
            { to: tx.to, data: tx.data },
            chainKey,
            { receipt: receipt ?? undefined, userAddress: from },
          );
        })()
      : this.parserService.parseSwapTx({ to: tx.to, data: tx.data }, chainKey);

    if (!parsed) {
      this.logger.log(
        `[${chainCfg.name}] watched tx parse skipped: ${txHash} to=${toLower}`,
      );
      return { hit: false, reason: "parse_skipped" };
    }

    const minNotional = watcher.config.minSignalNotionalUsdt;
    if (minNotional > 0) {
      const usd = await this.estimateSwapNotionalUsd(provider, chainKey, parsed);
      if (usd == null) {
        this.logger.log(
          `[${chainCfg.name}] watched tx skipped (notional unknown): ${txHash}`,
        );
        return { hit: false, reason: "notional_unknown" };
      }
      if (usd < minNotional) {
        this.logger.log(
          `[${chainCfg.name}] watched tx skipped (notional ${usd.toFixed(4)} USDT < min ${minNotional}): ${txHash}`,
        );
        return { hit: false, reason: "below_min_notional" };
      }
    }

    let price: number;
    try {
      price = await this.marketService.getLatestPriceByToken(parsed.token);
    } catch (err) {
      this.logger.warn(
        `Price fetch failed for token ${parsed.token}: ${err instanceof Error ? err.message : String(err)}; fallback to ETH spot`,
      );
      try {
        price = await this.marketService.getLatestPrice();
      } catch (fallbackErr) {
        this.logger.warn(
          `Fallback price fetch failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        );
        return { hit: false, reason: "price_fetch_failed" };
      }
    }

    try {
      this.engineManager.handleSignal(from, {
        type: parsed.type,
        token: parsed.token,
        price,
        amount: parsed.amount,
        chain: chainKey,
        config: watcher.config,
      });
      this.logger.log(`Signal from chain tx: ${from} ${parsed.type} ${parsed.token}`);
      return { hit: true, from, token: parsed.token, side: parsed.type };
    } catch (err) {
      this.logger.warn(
        `handleSignal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { hit: false, reason: "handle_signal_failed" };
    }
  }

  private async getTokenDecimals(
    provider: WebSocketProvider,
    chainKey: ChainKey,
    tokenAddress: string,
  ): Promise<number> {
    const key = `${chainKey}:${tokenAddress.toLowerCase()}`;
    const cached = this.tokenDecimalsCache.get(key);
    if (cached !== undefined) return cached;
    const erc20 = new Contract(
      tokenAddress,
      ["function decimals() view returns (uint8)"],
      provider,
    );
    const d = Number(await erc20.decimals());
    if (!Number.isFinite(d) || d < 0 || d > 36) {
      throw new Error(`invalid decimals: ${d}`);
    }
    this.tokenDecimalsCache.set(key, d);
    return d;
  }

  /** 解析得到的 swap USD（`amount` × Dexscreener 上 `amountInToken` 的 USD 价）。 */
  private async estimateSwapNotionalUsd(
    provider: WebSocketProvider,
    chainKey: ChainKey,
    parsed: ParsedSwap,
  ): Promise<number | null> {
    try {
      const token = getAddress(parsed.amountInToken);
      const dec = await this.getTokenDecimals(provider, chainKey, token);
      const raw = BigInt(parsed.amount);
      if (raw < 0n) return null;
      const human = Number(raw) / 10 ** dec;
      if (!Number.isFinite(human) || human < 0) return null;
      const px = await this.marketService.getLatestPriceByToken(token);
      if (!Number.isFinite(px) || px <= 0) return null;
      return human * px;
    } catch (err) {
      this.logger.debug(
        `estimateSwapNotionalUsd: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private makeWatcherKey(address: string, chain: ChainKey): string {
    return `${(address ?? "").trim().toLowerCase()}_${chain}`;
  }

  private getActiveWatcher(address: string, chain: ChainKey): ActiveWatcherSnapshot | null {
    const key = this.makeWatcherKey(address, chain);
    const watcher = this.activeWatchers.get(key);
    if (!watcher) return null;
    if (watcher.status !== "RUNNING") return null;
    return watcher;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  }

  private async withRetryOn429<T>(
    fn: () => Promise<T>,
    attempts: number,
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('"code": 429') && !msg.toLowerCase().includes("throughput")) {
          throw err;
        }
        if (i >= attempts - 1) break;
        const waitMs = 600 * (2 ** i);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

