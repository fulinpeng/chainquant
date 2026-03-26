import { Injectable, Logger } from "@nestjs/common";
import { Interface, getAddress } from "ethers";
import { CHAINS, type ChainConfig, type ChainKey } from "../config/chains";
import type { TransactionReceipt } from "ethers";

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

  private static readonly TRANSFER_TOPIC0 =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)

  // Uniswap V4 PoolManager Swap event topic0 (matches Arbiscan screenshot example).
  private static readonly UNISWAP_V4_SWAP_TOPIC0 =
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

  parseSwapTx(
    tx: { to?: string | null; data?: string | null },
    chain: ChainKey,
    ctx?: {
      receipt?: TransactionReceipt;
      userAddress?: string;
    },
  ): ParsedSwap | null {
    const chainConfig = CHAINS[chain];
    if (!chainConfig) {
      this.logger.warn(`Unknown chain: ${String(chain)}`);
      return null;
    }

    const to = (tx.to ?? "").toLowerCase();
    const data = tx.data ?? "";
    if (!to || !data || data.length < 10) return null;

    const isV3Router = chainConfig.v3Routers.includes(to);
    const isV4UniversalRouter = chainConfig.v4UniversalRouters.includes(to);
    if (!isV3Router && !isV4UniversalRouter) {
      this.logger.log(`[${chainConfig.name}] 未识别 router: ${to}`);
      return null;
    }

    // Uniswap V3: SwapRouter02 exactInputSingle
    if (isV3Router) {
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
        this.logger.warn(
          `[${chainConfig.name}] V3 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    // Uniswap V4: Universal Router (execute) -> parse from receipt logs
    if (isV4UniversalRouter) {
      const receipt = ctx?.receipt;
      const userAddress = ctx?.userAddress;
      if (!receipt) {
        this.logger.log(`[${chainConfig.name}] V4 解析需要 receipt`);
        return null;
      }
      if (!userAddress) {
        this.logger.log(`[${chainConfig.name}] V4 解析需要 userAddress`);
        return null;
      }
      return this.parseUniswapV4SwapFromReceipt(receipt, chainConfig, userAddress);
    }

    return null;
  }

  private parseUniswapV4SwapFromReceipt(
    receipt: TransactionReceipt,
    chainConfig: ChainConfig,
    userAddress: string,
  ): ParsedSwap | null {
    const user = userAddress.toLowerCase();

    const hasSwapEvent = receipt.logs.some((log) => {
      const t0 = log.topics?.[0]?.toLowerCase();
      return t0 === ParserService.UNISWAP_V4_SWAP_TOPIC0;
    });

    if (!hasSwapEvent) {
      this.logger.log(`[${chainConfig.name}] 非 swap（未命中 Uniswap V4 Swap 事件）`);
      return null;
    }

    let bestTokenOut: string | null = null;
    let bestValue: bigint = 0n;

    for (const log of receipt.logs) {
      if (!log.topics || log.topics.length < 3) continue;
      if (log.topics[0]?.toLowerCase() !== ParserService.TRANSFER_TOPIC0) continue;
      if (!log.data) continue;

      // topics: [event sig, from, to]
      const toTopic = log.topics[2];
      const toAddr = `0x${toTopic.slice(26)}`.toLowerCase();
      if (toAddr !== user) continue;

      let value: bigint;
      try {
        value = BigInt(log.data);
      } catch {
        continue;
      }
      if (value <= 0n) continue;

      const tokenAddr = log.address.toLowerCase();
      if (bestTokenOut === null || value > bestValue) {
        bestTokenOut = tokenAddr;
        bestValue = value;
      }
    }

    if (!bestTokenOut) {
      this.logger.log(`[${chainConfig.name}] 解析失败(未找到用户收到的 ERC20 转账)`);
      return null;
    }

    const type = bestTokenOut === chainConfig.wrappedNative.address ? "SELL" : "BUY";
    return {
      token: bestTokenOut,
      type,
      amount: bestValue.toString(),
    };
  }
}

