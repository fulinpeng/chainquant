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

@Injectable()
export class ListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListenerService.name);
  private provider: WebSocketProvider | null = null;
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
    if (!this.provider) return;
    try {
      await this.provider.destroy();
    } catch {
      // ignore
    }
    this.provider = null;
    this.started = false;
  }

  private start() {
    if (this.started) return;
    const wsUrl = (process.env.ETH_WS_URL ?? "").trim();
    if (!wsUrl) {
      this.logger.warn("ETH_WS_URL not set; chain listener disabled");
      return;
    }

    this.provider = new WebSocketProvider(wsUrl);
    this.provider.on("block", (blockNumber) => {
      void this.handleBlock(blockNumber);
    });
    this.started = true;
    this.logger.log("Chain listener started (ETH)");
  }

  private async handleBlock(blockNumber: number): Promise<void> {
    if (!this.provider) return;

    try {
      const block = await this.provider.getBlock(blockNumber);
      const txs = block?.transactions ?? [];
      for (const txHash of txs) {
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) continue;
        const from = (tx.from ?? "").toLowerCase();
        if (!from || !this.engineManager.isWatchedAddress(from)) continue;

        const parsed = this.parserService.parseSwapTx({
          to: tx.to,
          data: tx.data,
        });
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
    }
  }
}

