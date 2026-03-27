import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";
import type { ChainKey } from "../config/chains";
import * as fs from "node:fs";
import * as path from "node:path";

export type Watcher = {
  address: string;
  status: "RUNNING" | "STOPPED";
  createdAt: number;
};

@Injectable()
export class WatcherService implements OnModuleInit {
  private readonly logger = new Logger(WatcherService.name);
  private readonly storagePath = path.join(process.cwd(), "watchers.json");
  private watcherList: Watcher[] = [];

  constructor(private readonly listenerService: ListenerService) {}

  onModuleInit() {
    this.loadFromDisk();
    // Restore running watchers into listener watched set.
    for (const watcher of this.watcherList) {
      if (watcher.status === "RUNNING") {
        this.listenerService.addAddress(watcher.address);
      }
    }
  }

  add(address: string): Watcher {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const exists = this.watcherList.some((w) => w.address === normalized);
    if (exists) throw new BadRequestException("watcher already exists");

    const watcher: Watcher = {
      address: normalized,
      status: "STOPPED",
      createdAt: Date.now(),
    };
    this.watcherList.push(watcher);
    this.saveToDisk();
    return watcher;
  }

  list(): Watcher[] {
    return [...this.watcherList].sort((a, b) => b.createdAt - a.createdAt);
  }

  start(address: string): Watcher {
    const watcher = this.getOrThrow(address);
    watcher.status = "RUNNING";
    this.listenerService.addAddress(watcher.address);
    this.saveToDisk();
    return watcher;
  }

  stop(address: string): Watcher {
    const watcher = this.getOrThrow(address);
    watcher.status = "STOPPED";
    this.listenerService.removeAddress(watcher.address);
    this.saveToDisk();
    return watcher;
  }

  delete(address: string): { ok: true } {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const idx = this.watcherList.findIndex((w) => w.address === normalized);
    if (idx < 0) throw new BadRequestException("watcher not found");
    const watcher = this.watcherList[idx];
    if (watcher.status === "RUNNING") {
      this.listenerService.removeAddress(watcher.address);
    }
    this.watcherList.splice(idx, 1);
    this.saveToDisk();
    return { ok: true };
  }

  async replayTx(txHash: string, chain?: ChainKey) {
    return this.listenerService.replayTx({ txHash, chain });
  }

  private loadFromDisk() {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      this.watcherList = parsed
        .filter(
          (x): x is Watcher =>
            Boolean(
              x &&
                typeof x === "object" &&
                typeof (x as { address?: unknown }).address === "string" &&
                ((x as { status?: unknown }).status === "RUNNING" ||
                  (x as { status?: unknown }).status === "STOPPED") &&
                typeof (x as { createdAt?: unknown }).createdAt === "number",
            ),
        )
        .map((x) => ({
          address: x.address.toLowerCase(),
          status: x.status,
          createdAt: x.createdAt,
        }));
    } catch (err) {
      this.logger.warn(
        `Failed to load watchers.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private saveToDisk() {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.watcherList, null, 2), "utf8");
    } catch (err) {
      this.logger.warn(
        `Failed to save watchers.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private getOrThrow(address: string): Watcher {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const watcher = this.watcherList.find((w) => w.address === normalized);
    if (!watcher) throw new BadRequestException("watcher not found");
    return watcher;
  }
}

