import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { WebSocketProvider } from "ethers";
import { EngineManager } from "../engine/engine.manager";
import { MarketService } from "../market/market.service";
import { ParserService } from "./parser.service";
import { CHAINS, type ChainKey } from "../config/chains";

@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListenerService.name);
  private readonly providers = new Map<ChainKey, WebSocketProvider>();
  private started = false;

  constructor(
    private readonly engineManager: EngineManager,
    private readonly parserService: ParserService,
    private readonly marketService: MarketService,
  ) {}

  onModuleInit() {
    this.start();
  }

  async onModuleDestroy() {
    for (const provider of this.providers.values()) {
      try {
        await provider.destroy();
      } catch {
        // ignore
      }
    }
    this.providers.clear();
    this.started = false;
  }

  addAddress(address: string): { ok: true } {
    return this.engineManager.addAddress(address);
  }

  removeAddress(address: string): { ok: true } {
    return this.engineManager.removeAddress(address);
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
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        throw new BadRequestException(`tx not found: ${txHash}`);
      }

      const result = await this.processWatchedTx(chainKey, provider, txHash, {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        data: tx.data,
      });

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
      // Fetch block with full tx objects in one request to avoid per-tx RPC fan-out.
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
    if (!from || !this.engineManager.isWatchedAddress(from)) {
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
}

