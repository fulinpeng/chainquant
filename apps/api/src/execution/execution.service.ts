import { Injectable, Logger } from "@nestjs/common";
import { CHAINS } from "../config/chains";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { QuoterService } from "./quoter.service";

type ExecuteParams = {
  mode: "paper" | "live";
  tokenIn: string;
  tokenOut: string;
  amountInRaw?: string;
  maxTradeAmount: number;
  slippage: number;
};

type ExecuteResult =
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

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private inFlight = false;
  constructor(private readonly quoterService: QuoterService) {}

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
    const tokenInDecimals = await this.withRetryOn429(
      () =>
        isNativeInput
          ? Promise.resolve(18)
          : this.withTimeout(tokenInContract.decimals(), 10000, "decimals_timeout"),
      3,
    );
    const tokenOutDecimals = await this.withRetryOn429(
      () => this.withTimeout(tokenOutContract.decimals(), 10000, "decimals_timeout"),
      3,
    );
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
          await this.withRetryOn429(
            () => this.withTimeout(approveTx.wait(), 30000, "approve_wait_timeout"),
            3,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`approve_failed:${msg}`);
        }
      }
    }

    let tx: { hash: string };
    try {
      tx = await this.withRetryOn429(
        () =>
          this.withTimeout(
            router.exactInputSingle({
              tokenIn: input.tokenIn,
              tokenOut: input.tokenOut,
              fee: 3000,
              recipient: wallet.address,
              amountIn: amountInWei,
              amountOutMinimum,
              sqrtPriceLimitX96: 0,
            }, isNativeInput ? { value: amountInWei } : undefined),
            15000,
            "send_tx_timeout",
          ),
        3,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`send_tx_failed:${msg}`);
    }
    return {
      txHash: tx.hash as string,
      debug: {
        amountIn: amountInWei.toString(),
        quoteAmountOut: quotedAmountOut.toString(),
        minOut: amountOutMinimum.toString(),
        slippage: input.slippage,
      },
    };
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

