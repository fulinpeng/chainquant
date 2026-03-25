import { mainnet, base, bsc, arbitrum, optimism } from "wagmi/chains";

export type ChainCatalogItem = {
  name: string;
  label: string;
  value: string;
  walletValue: string;
  chainId: number;
  blockExplorerUrl: string;
  token: string[];
  rpcUrls: string[];
  icon?: unknown;
};

/**
 * Chain catalog for UI display and runtime allowlisting (SIWE chainId binding).
 * Keep it simple in MVP: no React icon components here.
 */
export const CHAIN_CATALOG: ChainCatalogItem[] = [
  {
    name: "Ethereum Mainnet",
    label: "Ethereum",
    value: "eth",
    walletValue: "eth",
    chainId: mainnet.id,
    icon: undefined,
    blockExplorerUrl: "https://etherscan.io/tx/",
    token: ["ETH", "USDT", "USDC"],
    rpcUrls: [
      "https://cloudflare-eth.com/",
      "https://eth-mainnet.gateway.pokt.network/v1/5f3453978e354ab992c4da79",
    ],
  },
  {
    name: "Base Mainnet",
    label: "Base",
    value: "base",
    walletValue: "base",
    chainId: base.id,
    icon: undefined,
    blockExplorerUrl: "https://basescan.org/tx/",
    token: ["ETH", "USDT", "USDC"],
    rpcUrls: ["https://mainnet.base.org/"],
  },
  {
    name: "BNB Chain",
    label: "BNB Chain",
    value: "bsc",
    walletValue: "bsc",
    chainId: bsc.id,
    icon: undefined,
    blockExplorerUrl: "https://bscscan.com/tx/",
    token: ["BNB", "USDT", "USDC"],
    rpcUrls: ["https://bsc-dataseed.binance.org/"],
  },
  {
    name: "Arbitrum One",
    label: "Arbitrum",
    value: "arbitrum",
    walletValue: "arbitrum",
    chainId: arbitrum.id,
    icon: undefined,
    blockExplorerUrl: "https://arbiscan.io/tx/",
    token: ["ETH", "USDT", "USDC"],
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
  },
  {
    name: "Optimism",
    label: "Optimism",
    value: "optimism",
    walletValue: "optimism",
    chainId: optimism.id,
    icon: undefined,
    blockExplorerUrl: "https://optimistic.etherscan.io/tx/",
    token: ["ETH", "USDT", "USDC"],
    rpcUrls: ["https://mainnet.optimism.io"],
  },
];

export const SUPPORTED_CHAIN_IDS = CHAIN_CATALOG.map((c) => c.chainId);

export function isSupportedChainId(chainId?: number) {
  return typeof chainId === "number" && SUPPORTED_CHAIN_IDS.includes(chainId);
}
