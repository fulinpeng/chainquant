import { BadRequestException, Injectable } from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";

export type Watcher = {
  address: string;
  status: "RUNNING" | "STOPPED";
  createdAt: number;
};

@Injectable()
export class WatcherService {
  private watcherList: Watcher[] = [];

  constructor(private readonly listenerService: ListenerService) {}

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
    return watcher;
  }

  list(): Watcher[] {
    return [...this.watcherList].sort((a, b) => b.createdAt - a.createdAt);
  }

  start(address: string): Watcher {
    const watcher = this.getOrThrow(address);
    watcher.status = "RUNNING";
    this.listenerService.addAddress(watcher.address);
    return watcher;
  }

  stop(address: string): Watcher {
    const watcher = this.getOrThrow(address);
    watcher.status = "STOPPED";
    this.listenerService.removeAddress(watcher.address);
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
    return { ok: true };
  }

  private getOrThrow(address: string): Watcher {
    const normalized = (address ?? "").trim().toLowerCase();
    if (!normalized) throw new BadRequestException("address is required");
    const watcher = this.watcherList.find((w) => w.address === normalized);
    if (!watcher) throw new BadRequestException("watcher not found");
    return watcher;
  }
}

