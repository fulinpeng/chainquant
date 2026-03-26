import {
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
  private readonly blockInFlight = new Set<ChainKey>();
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

  private start() {
    if (this.started) return;
    this.started = true;

    const entries = Object.entries(CHAINS) as Array<[ChainKey, (typeof CHAINS)[ChainKey]]>;
    for (const [chainKey, cfg] of entries) {
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
    if (this.blockInFlight.has(chainKey)) return;
    this.blockInFlight.add(chainKey);
    try {
      const block = await provider.getBlock(blockNumber);
      const txs = block?.transactions ?? [];
      for (const txHash of txs) {
        const tx = await provider.getTransaction(txHash);
        if (!tx) continue;
        const from = (tx.from ?? "").toLowerCase();
        if (!from || !this.engineManager.isWatchedAddress(from)) continue;

        const parsed = this.parserService.parseSwapTx({ to: tx.to, data: tx.data }, chainKey);
        if (!parsed) continue;

        let price: number;
        try {
          price = await this.marketService.getLatestPriceByToken(parsed.token);
        } catch (err) {
          this.logger.warn(
            `Price fetch failed for token ${parsed.token}: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }

        try {
          this.engineManager.handleSignal(from, {
            type: parsed.type,
            token: parsed.token,
            price,
          });
          this.logger.log(
            `Signal from chain tx: ${from} ${parsed.type} ${parsed.token}`,
          );
        } catch (err) {
          this.logger.warn(
            `handleSignal failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Block handling failed(${blockNumber}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.blockInFlight.delete(chainKey);
    }
  }
}

