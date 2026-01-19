import type { HardhatUserConfig } from "hardhat/config";
import {
  createHardhatConfig,
  createNodeTasks,
  initTelemetry,
} from "@paimaexample/evm-hardhat/hardhat-config-builder";
import {
  JsonRpcServerImplementation,
} from "@paimaexample/evm-hardhat/json-rpc-server";
import fs from "node:fs";
import waitOn from "wait-on";
import {
  ComponentNames,
  log,
  SeverityNumber,
} from "@paimaexample/log";

const __dirname: any = import.meta.dirname;

// Initialize telemetry
initTelemetry("@paimaexample/log", "./deno.json");

// Create node tasks
const nodeTasks = createNodeTasks({
  JsonRpcServer: {} as unknown as never, // Type placeholder, not used
  JsonRpcServerImplementation,
  ComponentNames,
  log,
  SeverityNumber,
  waitOn,
  fs,
});

const evmMainPort = 8545;
const evmParallelPort = 8546;
const evmMainChainId = 31337;
const evmParallelChainId = 31338;
const evmMainInterval = 250;
const evmParallelInterval = 1000;

// Create unified config with default networks
const config: HardhatUserConfig = createHardhatConfig({
  sourcesDir: `${__dirname}/src/contracts`,
  artifactsDir: `${__dirname}/build/artifacts/hardhat`,
  cacheDir: `${__dirname}/build/cache/hardhat`,
  networks: {
    arbitrumSepolia: {
      type: "http",
      chainId: 421614,
      url: Deno.env.get("ARBITRUM_SEPOLIA_RPC") || "http://127.0.0.1:8545",
      accounts: [Deno.env.get("EVM_PRIVATE_KEY") as `0x${string}` || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"],
    },
    evmMain: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: evmMainChainId,
      mining: {
        auto: true,
        interval: evmMainInterval,
      },
      allowBlocksWithSameTimestamp: true,
    },
    evmMainHttp: {
      type: "http",
      chainType: "l1",
      url: `http://0.0.0.0:${evmMainPort}`,
    },
    evmParallel: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: evmParallelChainId,
      mining: {
        auto: true,
        interval: evmParallelInterval,
      },
    },
    evmParallelHttp: {
      type: "http",
      chainType: "l1",
      url: `http://0.0.0.0:${evmParallelPort}`,
    },
  },
  tasks: nodeTasks,
  solidityVersion: "0.8.30",
});

export default config;
