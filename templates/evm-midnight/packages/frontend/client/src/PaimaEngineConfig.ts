import { hardhat, arbitrumSepolia } from "viem/chains";
import { PaimaEngineConfig } from "@paimaexample/wallets";

const isTestnet = (import.meta.env as any).MODE === "testnet" || (import.meta.env as any).VITE_MODE === "testnet";

export const paimaEngineConfig = new PaimaEngineConfig(
  "",
  isTestnet ? "parallelEvmRPC_fast" : "mainEvmRPC",
  isTestnet ? "0x3050DA616A9566322ce66a7499fecD0124f9c8B9" : "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  isTestnet ? arbitrumSepolia : hardhat,
  undefined,
  "http://localhost:3000/api",
  true,
);
