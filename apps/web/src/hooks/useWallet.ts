"use client";

import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useBalance } from "wagmi";
import { formatUnits } from "viem";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: balanceData, isLoading: isBalanceLoading } = useBalance({
    address,
    chainId,
  });
  const balanceFormatted = balanceData
    ? formatUnits(balanceData.value, balanceData.decimals)
    : undefined;

  const injected = connectors[0];

  return {
    address,
    isConnected,
    chainId,
    balanceFormatted,
    balanceSymbol: balanceData?.symbol,
    isBalanceLoading,
    connectors,
    connect: () => {
      if (injected) {
        connect({ connector: injected });
      }
    },
    switchChain,
    disconnect,
  };
}
