import { http, createConfig } from "wagmi";
import { mainnet, base, bsc, arbitrum, optimism } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/** wagmi：浏览器注入式钱包（如 MetaMask） */
export const wagmiConfig = createConfig({
  ssr: true,
  chains: [mainnet, base, bsc, arbitrum, optimism],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [bsc.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
  },
});
