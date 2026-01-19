import {
  type ContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Counter,
  type CounterPrivateState,
  witnesses,
} from "@example-evm-midnight/my-midnight-contract";
import {
  Transaction,
  type TransactionId,
} from "@midnight-ntwrk/ledger";
import {
  type DeployedContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";

import {
  type BalancedProvingRecipe,
  type ImpureCircuitId,
  type MidnightProvider,
  type MidnightProviders,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import type { Resource } from "@midnight-ntwrk/wallet";
import type { Wallet } from "@midnight-ntwrk/wallet-api";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import * as Rx from "rxjs";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { assertIsContractAddress } from "@midnight-ntwrk/midnight-js-utils";
import {
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import {
  BASE_URL_MIDNIGHT_INDEXER_API,
  BASE_URL_MIDNIGHT_INDEXER_WS,
  BASE_URL_PROOF_SERVER,
  MIDNIGHT_NETWORK_ID,
  getMidnightNodeUrl,
} from "./config.ts";
import {
  type ShieldedCoinInfo,
  LedgerParameters,
  ZswapSecretKeys,
  DustSecretKey,
  shieldedToken,
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
  type UnprovenTransaction,
} from "@midnight-ntwrk/ledger-v6";

import {
  type InitialAPI,
  type ConnectedAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { NetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// @ts-ignore: semver types might be missing in this environment
import semver from "semver";

// ============================================================================
// Constants
// ============================================================================

/** Wallet sync progress logging throttle interval */
const WALLET_SYNC_THROTTLE_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

// Inlined common types for standalone script
type CounterCircuits = ImpureCircuitId<Counter.Contract<CounterPrivateState>>;

const CounterPrivateStateId = "counterPrivateState";

type CounterProviders = MidnightProviders<
  CounterCircuits,
  typeof CounterPrivateStateId,
  CounterPrivateState
>;

type CounterContract = Counter.Contract;

type DeployedCounterContract =
  | DeployedContract<CounterContract>
  | FoundContract<CounterContract>;

export interface Config {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class WalletConfig implements Config {
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  constructor(config: { indexerUri: string, indexerWsUri: string, substrateNodeUri: string, proverServerUri?: string }) {
    this.indexer = config.indexerUri;
    this.indexerWS = config.indexerWsUri;
    this.node = config.substrateNodeUri;
    this.proofServer = config.proverServerUri ?? BASE_URL_PROOF_SERVER;
  }
}

// ============================================================================
// Wallet Logic
// ============================================================================

export type MidnightWallet = Wallet & Resource;

async function connectToWallet(networkId: NetworkId): Promise<ConnectedAPI> {
  const COMPATIBLE_CONNECTOR_API_VERSION = '>=1.0.0';

  const midnight = (window as any).midnight;
  if (!midnight) {
    throw new Error("Midnight Lace wallet not found. Extension installed?");
  }

  // Find a compatible wallet (e.g. mnLace)
  const wallets = Object.entries(midnight).filter(([_, api]: [string, any]) => 
     api.apiVersion && semver.satisfies(api.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
  ) as [string, any][];

  if (wallets.length === 0) {
    throw new Error("No compatible Midnight wallet found.");
  }

  // Connect to the first compatible wallet (usually mnLace)
  const [name, api] = wallets[0];
  console.log(`Connecting to wallet: ${name} (version ${api.apiVersion})`);
  
  // Add password provider to the wallet API as requested by the user
  const passwordProvider = async () => "PAIMA_STORAGE_PASSWORD"

  // Create a robust wrapper that includes the password provider
  // We use spread to copy own properties, then manually ensure connect is present
  // (in case it's on the prototype chain) and inject our provider.
  const apiWithPassword: any = { ...api };
  
  if (typeof apiWithPassword.connect !== 'function') {
      apiWithPassword.connect = api.connect;
  }
  
  apiWithPassword.privateStoragePasswordProvider = passwordProvider;

  // Call connect on our wrapper object so 'this' context includes the password provider
  return await apiWithPassword.connect(networkId);
}

function createWalletAndMidnightProvider(
  connectedAPI: ConnectedAPI,
  coinPublicKey: CoinPublicKey,
  encryptionPublicKey: EncPublicKey
): WalletProvider & MidnightProvider {
  return {
    getCoinPublicKey(): CoinPublicKey {
      return coinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return encryptionPublicKey;
    },
    async balanceTx(
      tx: UnprovenTransaction,
      _newCoins?: ShieldedCoinInfo[],
      _ttl?: Date
    ): Promise<BalancedProvingRecipe> {
      // Convert transaction to hex string as expected by the dApp connector
      const serializedTx = tx.serialize();
      const hexTx = Array.from(serializedTx)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      
      const result = await connectedAPI.balanceUnsealedTransaction(hexTx);
      return result as unknown as BalancedProvingRecipe;
    },
    submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      const serializedTx = tx.serialize();
      const hexTx = Array.from(serializedTx)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
        
      return connectedAPI.submitTransaction(hexTx) as unknown as Promise<TransactionId>;
    },
  };
}

// ============================================================================
// Counter Logic
// ============================================================================

const counterContractInstance: CounterContract = new Counter.Contract(
  witnesses,
);

const getCounterLedgerState = async (
  providers: CounterProviders,
  contractAddress: ContractAddress,
): Promise<bigint | null> => {
  assertIsContractAddress(contractAddress);
  console.log("🔍 Checking contract ledger state...");

  try {
    const contractState = await providers.publicDataProvider.queryContractState(
      contractAddress,
    );
    const state = contractState != null
      ? Counter.ledger(contractState.data).round
      : null;
    console.log(`📊 Ledger state: ${state}`);
    return state;
  } catch (error) {
    console.error("❌ Error getting counter ledger state:", error);
    throw error;
  }
};

const joinContract = async (
  providers: CounterProviders,
  contractAddress: string,
): Promise<DeployedCounterContract> => {
  const counterContract = await findDeployedContract(providers, {
    contractAddress,
    contract: counterContractInstance,
    privateStateId: "counterPrivateState",
    initialPrivateState: { privateCounter: 0 },
  });
  console.log(
    `Joined contract at address: ${counterContract.deployTxData.public.contractAddress}`,
  );
  return counterContract;
};

const increment = async (
  counterContract: DeployedCounterContract,
  contractAddress: string,
  tokenId: string,
  propertyName: string,
  propertyValue: string,
): Promise<any> => {
  console.log("Incrementing...");

  console.log(`📝 Using parameters:`);
  console.log(`   Contract Address: ${contractAddress}`);
  console.log(`   Token ID: ${tokenId}`);
  console.log(`   Property Name: ${propertyName}`);
  console.log(`   Property Value: ${propertyValue}`);

  const toEncodedString = (str: string, length = 32) =>
    Uint8Array.from(
      str.padEnd(length, " ").split("").map((c) => c.charCodeAt(0)),
    );
  const finalizedTxData = await counterContract.callTx.increment(
    toEncodedString(contractAddress, 64),
    toEncodedString(tokenId, 64),
    toEncodedString(propertyName, 32),
    toEncodedString(propertyValue, 32),
  );
  console.log(
    `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`,
  );
  return finalizedTxData.public;
};

const displayCounterValue = async (
  providers: CounterProviders,
  counterContract: DeployedCounterContract,
): Promise<{ counterValue: bigint | null; contractAddress: string }> => {
  const contractAddress = counterContract.deployTxData.public.contractAddress;
  const counterValue = await getCounterLedgerState(providers, contractAddress);
  if (counterValue === null) {
    console.log(`There is no counter contract deployed at ${contractAddress}.`);
  } else {
    console.log(`Current counter value: ${Number(counterValue)}`);
  }
  return { contractAddress, counterValue };
};

export const configureProviders = async (
  connectedAPI: ConnectedAPI,
  config: Config,
  coinPublicKey: CoinPublicKey,
  encryptionPublicKey: EncPublicKey
) => {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(
    connectedAPI,
    coinPublicKey,
    encryptionPublicKey
  );

  const privateStateProvider = levelPrivateStateProvider({
    privateStoragePasswordProvider: async () => "PAIMA_STORAGE_PASSWORD" // Using the same password for level storage
  } as any);

  const publicDataProvider = indexerPublicDataProvider(
    config.indexer,
    config.indexerWS,
  );

  const zkConfigPath = window.location.origin;

  const zkConfigProvider = new FetchZkConfigProvider(
    zkConfigPath,
    fetch.bind(window),
  );
  const proofProvider = httpClientProofProvider(config.proofServer);

  const providers: CounterProviders = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
  return providers;
};

/**
 * Get contract address from command line arguments or from a file
 */
const getContractAddress = async (): Promise<string> => {
  const candidates = [
    `contract_address/contract-round-value.${MIDNIGHT_NETWORK_ID}.json`,
    `contract_address/contract-round-value.json`,
    `contract_address/contract.json`,
  ];

  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate);
      if (!r.ok) continue;
      const json = await r.json();
      
      // Handle network-keyed address if present
      if (typeof json.contractAddress === 'object') {
        const address = json.contractAddress[MIDNIGHT_NETWORK_ID];
        if (address) {
          console.log(`🔍 Contract address (${MIDNIGHT_NETWORK_ID}) from ${candidate}:`, address);
          return address;
        }
        continue;
      }
      
      if (json.contractAddress) {
        console.log(`🔍 Contract address from ${candidate}:`, json.contractAddress);
        return json.contractAddress;
      }
    } catch (e) {
      // ignore and try next
    }
  }

  throw new Error(`Could not resolve contract address for network ${MIDNIGHT_NETWORK_ID}`);
};

// Separate functions for Web App use
// Global variables updated to hold new types
let globalWallet: (Wallet & Resource) | null = null;
let globalProviders: CounterProviders | null = null;
let globalCounterContract: DeployedCounterContract | null = null;


const connectToContract = async (
  providers: CounterProviders,
  contractAddress?: string,
): Promise<{
  counterContract: DeployedCounterContract;
  currentState: { counterValue: bigint | null; contractAddress: string };
}> => {
  const address = contractAddress || await getContractAddress();
  console.log(`🔗 Joining counter contract at address: ${address}`);

  const counterContract = await joinContract(providers, address);
  console.log("✅ Successfully joined the counter contract");

  // Get initial state
  const currentState = await displayCounterValue(providers, counterContract);
  console.log(`📊 Current counter value: ${currentState.counterValue}`);

  // Store globally for later use
  globalCounterContract = counterContract;

  return { counterContract, currentState };
};

const fetchCurrentCounterState = async (
  providers?: CounterProviders,
  counterContract?: DeployedCounterContract,
): Promise<{ counterValue: bigint | null; contractAddress: string }> => {
  const actualProviders = providers || globalProviders;
  const actualContract = counterContract || globalCounterContract;

  if (!actualProviders || !actualContract) {
    throw new Error("Providers and contract must be initialized first");
  }

  return await displayCounterValue(actualProviders, actualContract);
};

const incrementCounterValue = async (
  contractAddress: string,
  tokenId: string,
  propertyName: string,
  propertyValue: string,
  counterContract?: DeployedCounterContract,
): Promise<any> => {
  const actualContract = counterContract || globalCounterContract;

  if (!actualContract) {
    throw new Error("Contract must be joined first");
  }

  console.log("🔢 Incrementing counter...");
  const result = await increment(
    actualContract,
    contractAddress,
    tokenId,
    propertyName || "",
    propertyValue || "",
  );
  console.log(
    `✅ Counter incremented successfully! Transaction ID: ${result.txId}`,
  );

  return result;
};

export {
  connectToContract,
  fetchCurrentCounterState,
  incrementCounterValue,
};
