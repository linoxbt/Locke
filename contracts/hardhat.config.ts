import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";

// Fork tests run against Base mainnet, where Veranta's contracts live.
const BASE_RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  paths: { sources: "src", tests: "test" },
  networks: {
    hardhat: process.env.FORK
      ? {
          forking: { url: BASE_RPC, blockNumber: process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined },
          chainId: 8453,
          hardfork: "cancun",
          chains: { 8453: { hardforkHistory: { cancun: 0 } } },
        }
      : {},
    verantaTest: { url: "https://devnet-rpc.veranta.xyz", chainId: 8453 },
  },
  mocha: { timeout: 600_000 },
};

export default config;
