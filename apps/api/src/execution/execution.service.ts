import { Injectable, Logger } from "@nestjs/common";
import { CHAINS } from "../config/chains";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  parseUnits,
  type TransactionLike,
  type TransactionReceipt,
  type TransactionResponse,
} from "ethers";
import { QuoterService } from "./quoter.service";

type ExecuteParams = {
  mode: "paper" | "live";
  tokenIn: string;
  tokenOut: string;
  amountInRaw?: string;
  maxTradeAmount: number;
  slippage: number;
};

export type ExecuteResult =
  | {
      ok: true;
      mode: "paper" | "live";
      txHash?: string;
      debug?: {
        amountIn: string;
        quoteAmountOut: string;
        minOut: string;
        slippage: number;
      };
    }
  | {
      ok: false;
      mode: "paper" | "live";
      reason: string;
      debug?: {
        amountIn: string;
        quoteAmountOut: string;
        minOut: string;
        slippage: number;
      };
    };

/** 从 provider.getTransaction 得到的非空交易快照，用于同 nonce 替换。 */
type OnChainTxSnapshot = NonNullable<Awaited<ReturnType<JsonRpcProvider["getTransaction"]>>>;

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private inFlight = false;
  constructor(private readonly quoterService: QuoterService) {}

  /** 单笔交易处于 pending 的最长等待（毫秒），超时则尝试加价同 nonce 重发。 */
  private getPendingTimeoutMs(): number {
    const n = Number(process.env.EXEC_TX_PENDING_TIMEOUT_MS ?? "45000");
    return Number.isFinite(n) && n >= 5000 ? Math.floor(n) : 45000;
  }

  /** 最多加价重发次数（不含首笔广播）。 */
  private getMaxGasBumps(): number {
    const n = Number(process.env.EXEC_TX_MAX_GAS_BUMPS ?? "4");
    return Number.isFinite(n) && n >= 0 ? Math.min(20, Math.floor(n)) : 4;
  }

  /** 每次在现价基础上乘以 num/100，默认 115 = 1.15 倍。 */
  private getGasBumpRatio(): { num: bigint; den: bigint } {
    const parsed = parseInt(process.env.EXEC_TX_GAS_BUMP_NUM ?? "115", 10);
    const n = Number.isFinite(parsed) && parsed >= 101 && parsed <= 200 ? parsed : 115;
    return { num: BigInt(n), den: 100n };
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    if (this.inFlight) {
      return { ok: false, mode: params.mode, reason: "trade_in_flight" };
    }
    if (!Number.isFinite(params.maxTradeAmount) || params.maxTradeAmount <= 0) {
      return { ok: false, mode: params.mode, reason: "invalid_max_trade_amount" };
    }
    if (!Number.isFinite(params.slippage) || params.slippage <= 0 || params.slippage > 0.05) {
      return { ok: false, mode: params.mode, reason: "invalid_slippage" };
    }
    if (!this.isAllowedPair(params.tokenIn, params.tokenOut)) {
      return { ok: false, mode: params.mode, reason: "unsupported_pair" };
    }

    if (params.mode === "paper") {
      return { ok: true, mode: "paper" };
    }

    this.inFlight = true;
    try {
      const execution = await this.sendSwapTx({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountInRaw: params.amountInRaw,
        maxTradeAmount: params.maxTradeAmount,
        slippage: params.slippage,
      });
      return { ok: true, mode: "live", txHash: execution.txHash, debug: execution.debug };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live execution failed: ${msg}`);
      return {
        ok: false,
        mode: "live",
        reason: this.normalizeExecutionError(msg),
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async sendSwapTx(input: {
    tokenIn: string;
    tokenOut: string;
    amountInRaw?: string;
    maxTradeAmount: number;
    slippage: number;
  }): Promise<{
    txHash: string;
    debug: {
      amountIn: string;
      quoteAmountOut: string;
      minOut: string;
      slippage: number;
    };
  }> {
    const rpcUrl = (process.env.RPC_URL ?? "").trim();
    const privateKey = (process.env.PRIVATE_KEY ?? "").trim();
    if (!rpcUrl || !privateKey) {
      throw new Error("RPC_URL or PRIVATE_KEY is missing");
    }

    const provider = new JsonRpcProvider(rpcUrl);
    await this.ensureRpcAvailable(provider);
    const wallet = new Wallet(privateKey, provider);
    const routerAddress = CHAINS.arb.v3Routers[0];
    if (!routerAddress) {
      throw new Error("arb v3 router is not configured");
    }

    const abi = [
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    ];
    const erc20Abi = [
      "function allowance(address owner,address spender) view returns (uint256)",
      "function approve(address spender,uint256 value) returns (bool)",
      "function decimals() view returns (uint8)",
    ];
    const router = new Contract(routerAddress, abi, wallet);
    const tokenInContract = new Contract(input.tokenIn, erc20Abi, wallet);
    const tokenOutContract = new Contract(input.tokenOut, erc20Abi, wallet);
    const wrappedNative = CHAINS.arb.wrappedNative.address.toLowerCase();
    const isNativeInput = input.tokenIn.toLowerCase() === wrappedNative;
    const tokenInDecimals = isNativeInput
      ? 18
      : await this.readTokenDecimalsSafe(input.tokenIn, tokenInContract);
    const tokenOutDecimals = await this.readTokenDecimalsSafe(input.tokenOut, tokenOutContract);
    const maxTradeAmountRaw = parseUnits(String(input.maxTradeAmount), tokenInDecimals);
    const parsedRawAmount = this.parseRawAmount(input.amountInRaw);
    const amountInWei = parsedRawAmount
      ? (parsedRawAmount > maxTradeAmountRaw ? maxTradeAmountRaw : parsedRawAmount)
      : maxTradeAmountRaw;
    if (amountInWei <= 0n) {
      throw new Error("invalid_amount");
    }

    let quotedAmountOut: bigint;
    try {
      quotedAmountOut = await this.withRetryOn429(
        () =>
          this.withTimeout(
            this.quoterService.quoteExactInputSingle({
              tokenIn: input.tokenIn,
              tokenOut: input.tokenOut,
              fee: 3000,
              amountIn: amountInWei,
            }),
            12000,
            "quote_timeout",
          ),
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`quote_failed:${msg}`);
    }
    const bps = Math.floor(input.slippage * 10_000);
    const amountOutMinimum = (quotedAmountOut * BigInt(10_000 - bps)) / 10_000n;
    this.logger.log(
      `live swap quote amountIn=${amountInWei.toString()} amountOut=${quotedAmountOut.toString()} minOut=${amountOutMinimum.toString()} slippage=${input.slippage} tokenInDecimals=${tokenInDecimals} tokenOutDecimals=${tokenOutDecimals}`,
    );

    if (!isNativeInput) {
      const allowance = (await this.withRetryOn429(
        () =>
          this.withTimeout(
            tokenInContract.allowance(wallet.address, routerAddress),
            10000,
            "allowance_timeout",
          ),
        3,
      )) as bigint;
      if (allowance < amountInWei) {
        try {
          const approveTx = await this.withRetryOn429(
            () =>
              this.withTimeout(
                tokenInContract.approve(routerAddress, amountInWei),
                12000,
                "approve_timeout",
              ),
            3,
          );
          await this.waitUntilMinedWithGasBump(wallet, provider, approveTx, "approve");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`approve_failed:${msg}`);
        }
      }
    }

    let swapTx: TransactionResponse;
    try {
      swapTx = await this.withRetryOn429(
        () =>
          this.withTimeout(
            router.exactInputSingle(
              {
                tokenIn: input.tokenIn,
                tokenOut: input.tokenOut,
                fee: 3000,
                recipient: wallet.address,
                amountIn: amountInWei,
                amountOutMinimum,
                sqrtPriceLimitX96: 0,
              },
              isNativeInput ? { value: amountInWei } : undefined,
            ),
            15000,
            "send_tx_timeout",
          ),
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`send_tx_failed:${msg}`);
    }
    const swapReceipt = await this.waitUntilMinedWithGasBump(
      wallet,
      provider,
      swapTx,
      "swap",
    );
    return {
      txHash: swapReceipt.hash,
      debug: {
        amountIn: amountInWei.toString(),
        quoteAmountOut: quotedAmountOut.toString(),
        minOut: amountOutMinimum.toString(),
        slippage: input.slippage,
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async buildGasBumpedReplacement(
    provider: JsonRpcProvider,
    tx: OnChainTxSnapshot,
    num: bigint,
    den: bigint,
  ): Promise<TransactionLike<string>> {
    const fee = await provider.getFeeData();
    const to = tx.to;
    if (to == null) {
      throw new Error("replacement_requires_to");
    }
    const bump = (g: bigint) => (g * num) / den;
    const maxB = (a: bigint, b: bigint) => (a > b ? a : b);

    const base: TransactionLike<string> = {
      to,
      data: tx.data,
      value: tx.value,
      nonce: tx.nonce,
      gasLimit: tx.gasLimit,
      chainId: tx.chainId,
    };

    if (tx.maxFeePerGas != null && tx.maxPriorityFeePerGas != null) {
      let mf = bump(tx.maxFeePerGas);
      let mp = bump(tx.maxPriorityFeePerGas);
      const nm = fee.maxFeePerGas ?? 0n;
      const npc = fee.maxPriorityFeePerGas ?? 0n;
      if (nm > 0n) mf = maxB(mf, bump(nm));
      if (npc > 0n) mp = maxB(mp, bump(npc));
      if (mp > mf) mp = mf;
      return { ...base, type: 2, maxFeePerGas: mf, maxPriorityFeePerGas: mp };
    }

    if (tx.gasPrice != null && tx.gasPrice > 0n) {
      let gp = bump(tx.gasPrice);
      const ng = fee.gasPrice ?? 0n;
      if (ng > 0n) gp = maxB(gp, bump(ng));
      return { ...base, type: 0, gasPrice: gp };
    }

    if (fee.maxFeePerGas == null || fee.maxPriorityFeePerGas == null) {
      throw new Error("fee_data_unavailable_for_replacement");
    }
    let mf2 = bump(fee.maxFeePerGas);
    let mp2 = bump(fee.maxPriorityFeePerGas);
    if (mp2 > mf2) mp2 = mf2;
    return { ...base, type: 2, maxFeePerGas: mf2, maxPriorityFeePerGas: mp2 };
  }

  /**
   * 等待交易上链；若在 EXEC_TX_PENDING_TIMEOUT_MS 内仍为 pending，则按更高 gas 同 nonce 重发，最多 EXEC_TX_MAX_GAS_BUMPS 次。
   */
  private async waitUntilMinedWithGasBump(
    wallet: Wallet,
    provider: JsonRpcProvider,
    sent: TransactionResponse,
    context: string,
  ): Promise<TransactionReceipt> {
    const pollMs = 2000;
    const timeoutMs = this.getPendingTimeoutMs();
    const maxBumps = this.getMaxGasBumps();
    const { num, den } = this.getGasBumpRatio();

    let snapshot: OnChainTxSnapshot | null = null;
    for (let attempt = 0; attempt < 10 && snapshot == null; attempt++) {
      snapshot = await provider.getTransaction(sent.hash);
      if (snapshot == null) await this.sleep(250);
    }
    if (snapshot == null) {
      throw new Error(`${context}_tx_not_found`);
    }

    let currentHash = sent.hash;

    for (let round = 0; round <= maxBumps; round++) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await provider.getTransactionReceipt(currentHash);
        if (r) {
          if (r.status === 0) {
            throw new Error(`${context}_reverted`);
          }
          return r;
        }
        await this.sleep(pollMs);
      }

      const r2 = await provider.getTransactionReceipt(currentHash);
      if (r2) {
        if (r2.status === 0) {
          throw new Error(`${context}_reverted`);
        }
        return r2;
      }

      if (round === maxBumps) {
        throw new Error(`${context}_pending_timeout`);
      }

      const onChain = await provider.getTransaction(currentHash);
      if (onChain) {
        snapshot = onChain;
      }
      if (snapshot == null) {
        throw new Error(`${context}_pending_lost_tx_meta`);
      }

      const replacement = await this.buildGasBumpedReplacement(provider, snapshot, num, den);
      this.logger.warn(
        `[${context}] pending ≥${timeoutMs}ms，同 nonce 加价重发 (${round + 1}/${maxBumps}) nonce=${snapshot.nonce}`,
      );
      const next = await this.withRetryOn429(
        () =>
          this.withTimeout(
            wallet.sendTransaction(replacement),
            20000,
            `${context}_bump_send_timeout`,
          ),
        3,
      );
      currentHash = next.hash;
      const fresh = await provider.getTransaction(currentHash);
      if (fresh) {
        snapshot = fresh;
      }
      await this.sleep(500);
    }

    throw new Error(`${context}_pending_timeout`);
  }

  private isAllowedPair(tokenIn: string, tokenOut: string): boolean {
    const a = (tokenIn ?? "").toLowerCase();
    const b = (tokenOut ?? "").toLowerCase();
    const stableAddrs = CHAINS.arb.stableTokens.map((t) => t.address.toLowerCase());
    if (!a || !b || a === b) return false;
    const aIsStable = stableAddrs.includes(a);
    const bIsStable = stableAddrs.includes(b);
    // 仅允许“稳定币 <-> 非稳定币”，拒绝稳定币互换与非稳定币互换。
    return aIsStable !== bIsStable;
  }

  private parseRawAmount(raw?: string): bigint | null {
    if (!raw) return null;
    try {
      const n = BigInt(raw);
      if (n <= 0n) return null;
      return n;
    } catch {
      return null;
    }
  }

  private normalizeExecutionError(msg: string): string {
    if (!msg) return "unknown_error";
    if (this.isRpcUnavailableMessage(msg)) return `rpc_unavailable (${msg})`;
    if (msg.startsWith("quote_failed:")) return `quote_failed (${msg.slice("quote_failed:".length)})`;
    if (msg.startsWith("approve_failed:")) return `approve_failed (${msg.slice("approve_failed:".length)})`;
    if (msg.startsWith("send_tx_failed:")) return `send_tx_failed (${msg.slice("send_tx_failed:".length)})`;
    if (msg.includes("timeout") || msg.includes("TIMEOUT")) return `timeout (${msg})`;
    return msg;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  }

  private async withRetryOn429<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.isRpcRetryableMessage(msg)) {
          throw err;
        }
        if (i >= attempts - 1) break;
        const waitMs = 600 * (2 ** i);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async ensureRpcAvailable(provider: JsonRpcProvider): Promise<void> {
    try {
      await this.withRetryOn429(
        () => this.withTimeout(provider.getNetwork(), 8000, "rpc_network_timeout"),
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`rpc_unavailable:${msg}`);
    }
  }

  private async readTokenDecimalsSafe(
    tokenAddress: string,
    tokenContract: Contract,
  ): Promise<number> {
    try {
      return await this.withRetryOn429(
        () => this.withTimeout(tokenContract.decimals(), 10000, "decimals_timeout"),
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fallback = this.getKnownTokenDecimals(tokenAddress);
      if (fallback !== null) {
        this.logger.warn(
          `decimals() failed for ${tokenAddress}, fallback to ${fallback}: ${
            msg
          }`,
        );
        return fallback;
      }
      if (this.isRpcUnavailableMessage(msg)) {
        throw new Error(`rpc_unavailable:${msg}`);
      }
      throw err;
    }
  }

  private getKnownTokenDecimals(tokenAddress: string): number | null {
    const t = (tokenAddress ?? "").toLowerCase();
    if (!t) return null;
    if (t === CHAINS.arb.wrappedNative.address.toLowerCase()) return 18;
    const stable = CHAINS.arb.stableTokens.find((x) => x.address.toLowerCase() === t);
    if (!stable) return null;
    if (stable.symbol.toUpperCase() === "USDC") return 6;
    if (stable.symbol.toUpperCase() === "USDT") return 6;
    return null;
  }

  private isRpcUnavailableMessage(msg: string): boolean {
    const s = (msg ?? "").toLowerCase();
    return (
      s.includes('"code": 429') ||
      s.includes("throughput") ||
      s.includes("failed to detect network") ||
      s.includes("rpc_network_timeout") ||
      s.includes("network is not started") ||
      s.includes("network changed") ||
      s.includes("missing revert data")
    );
  }

  private isRpcRetryableMessage(msg: string): boolean {
    const s = (msg ?? "").toLowerCase();
    return (
      s.includes('"code": 429') ||
      s.includes("throughput") ||
      s.includes("failed to detect network") ||
      s.includes("rpc_network_timeout")
    );
  }
}

