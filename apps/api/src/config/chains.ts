export type ChainKey = "ethereum" | "base" | "op" | "arb" | "bnb";

export type ChainConfig = {
  key: ChainKey;
  name: string;
  wsUrlEnv: string;
  routers: string[]; // lowercased addresses
  wrappedNative: {
    symbol: string;
    address: string; // lowercased address
  };
};

// Minimal Uniswap V3 periphery recognition via `exactInputSingle`.
// Add/adjust router addresses as you discover them on each chain.
export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    wsUrlEnv: "ETH_WS_URL",
    routers: [
      "0xe592427a0aece92de3edee1f18e0157c05861564",
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0xc02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase(),
    },
  },
  base: {
    key: "base",
    name: "Base",
    wsUrlEnv: "BASE_WS_URL",
    routers: [
      // Base deployments (commonly used SwapRouter02 address)
      "0x2626664c2603336e57b271c5c0b26f421741e481",
      // Some routers share the same address across chains as well.
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006".toLowerCase(),
    },
  },
  op: {
    key: "op",
    name: "Optimism",
    wsUrlEnv: "OP_WS_URL",
    routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    wrappedNative: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006".toLowerCase(),
    },
  },
  arb: {
    key: "arb",
    name: "Arbitrum",
    wsUrlEnv: "ARB_WS_URL",
    routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    wrappedNative: {
      symbol: "WETH",
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1".toLowerCase(),
    },
  },
  bnb: {
    key: "bnb",
    name: "BNB Chain",
    wsUrlEnv: "BNB_WS_URL",
    routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    wrappedNative: {
      symbol: "WBNB",
      address: "0xbb4cdb9cbdd36b01bd1cbaebf2de08d9173bc095c".toLowerCase(),
    },
  },
};

