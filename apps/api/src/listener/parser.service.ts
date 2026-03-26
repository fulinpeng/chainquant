import { Injectable, Logger } from "@nestjs/common";
import { Interface, dataSlice, getAddress, zeroPadValue } from "ethers";
import { CHAINS, type ChainKey } from "../config/chains";

export type ParsedSwap = {
  token: string;
  type: "BUY" | "SELL";
  amount: string;
};

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);
  private readonly v3Iface = new Interface([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)",
  ]);

  /**
   * MVP parser: supports a subset of Uniswap V3 swap calldata.
   * Returns null when tx is not recognized as a swap signal.
   */
  parseSwapTx(
    tx: { to?: string | null; data?: string | null },
    chain: ChainKey,
  ): ParsedSwap | null {
    const chainConfig = CHAINS[chain];
    if (!chainConfig) {
      this.logger.warn(`Unknown chain: ${String(chain)}`);
      return null;
    }

    const to = (tx.to ?? "").toLowerCase();
    const data = tx.data ?? "";
    if (!to || !data || data.length < 10) return null;

    if (!chainConfig.routers.includes(to)) {
      this.logger.log(`[${chainConfig.name}] 未识别 router: ${to}`);
      return null;
    }

    // exactInputSingle selector: 0x04e45aaf
    if (!data.startsWith("0x04e45aaf")) {
      this.logger.log(`[${chainConfig.name}] 非 exactInputSingle swap`);
      return null;
    }
    try {
      const decoded = this.v3Iface.decodeFunctionData("exactInputSingle", data);
      const params = decoded[0] as {
        tokenIn: string;
        tokenOut: string;
        amountIn: bigint;
      };
      const tokenIn = getAddress(params.tokenIn);
      const tokenOut = getAddress(params.tokenOut);
      const amount = params.amountIn.toString();

      const isBuy = tokenIn.toLowerCase() === chainConfig.wrappedNative.address;
      const token = isBuy ? tokenOut : tokenIn;
      return {
        token,
        type: isBuy ? "BUY" : "SELL",
        amount,
      };
    } catch (err) {
      // fallback: best-effort raw parse for tokenIn/tokenOut
      this.logger.warn(
        `[${chainConfig.name}] 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        const tokenInRaw = dataSlice(data, 4 + 12, 4 + 32);
        const tokenOutRaw = dataSlice(data, 4 + 32 + 12, 4 + 64);
        const tokenIn = getAddress(zeroPadValue(tokenInRaw, 20));
        const tokenOut = getAddress(zeroPadValue(tokenOutRaw, 20));
        const isBuy = tokenIn.toLowerCase() === chainConfig.wrappedNative.address;
        return {
          token: isBuy ? tokenOut : tokenIn,
          type: isBuy ? "BUY" : "SELL",
          amount: "0",
        };
      } catch {
        this.logger.log(`[${chainConfig.name}] 解析失败(回退也失败)`);
        return null;
      }
    }
  }
}

