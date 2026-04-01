import { Injectable } from "@nestjs/common";

export type Reservation = {
  address: string;
  amount: number;
};

/**
 * 按 address 维度的内存预占，防止多 watcher / 多引擎并发超额占用同一账户名义资金。
 */
@Injectable()
export class FundsService {
  private readonly reserved = new Map<string, number>();

  getReserved(address: string): number {
    const a = (address ?? "").trim().toLowerCase();
    return this.reserved.get(a) ?? 0;
  }

  /**
   * @param balance 账户总余额（与预占同单位）；校验使用 (已预占 + amount) <= balance。
   */
  reserve(address: string, amount: number, balance: number): boolean {
    const a = (address ?? "").trim().toLowerCase();
    if (!a || !Number.isFinite(amount) || amount <= 0) return false;
    if (!Number.isFinite(balance) || balance < 0) return false;
    const current = this.getReserved(a);
    if (current + amount > balance) {
      return false;
    }
    this.reserved.set(a, current + amount);
    return true;
  }

  release(address: string, amount: number): void {
    const a = (address ?? "").trim().toLowerCase();
    if (!a || !Number.isFinite(amount) || amount <= 0) return;
    const current = this.getReserved(a);
    const next = Math.max(0, current - amount);
    if (next === 0) {
      this.reserved.delete(a);
    } else {
      this.reserved.set(a, next);
    }
  }
}
