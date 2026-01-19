import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { InitialAPI, ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { type Wallet, walletLogin, type WalletOption } from "@paimaexample/wallets";
import type { AddressType } from "@paimaexample/utils";
import { getAddressType, WalletMode } from "@paimaexample/wallets";
import { MIDNIGHT_NETWORK_ID } from "../config.ts";
type LoginInfo = any;

export type ActiveConnection<T> = {
  metadata: WalletOption;
  api: T;
};

export type MidnightWalletConnection = {
  provider: ConnectedAPI;
  walletAddress: string;
  metadata: WalletOption;
};

interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  wallet: Wallet | null;
  midnightWallet: MidnightWalletConnection | null;
  connectEvmWallet: (loginInfo: LoginInfo) => Promise<any>;
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

interface WalletProviderProps {
  children: ReactNode;
}

// Wrapper class to make v4 ConnectedAPI compatible with IProvider interface
export class MidnightProviderWrapper {
  api: ConnectedAPI;
  metadata: WalletOption;

  constructor(api: ConnectedAPI, metadata: WalletOption) {
    this.api = api;
    this.metadata = metadata;
  }

  getConnection(): ActiveConnection<MidnightProviderWrapper> {
    return {
      metadata: this.metadata,
      api: this,
    };
  }

  async signMessage(message: string): Promise<string> {
    const result = await this.api.signData(message, {
      encoding: 'text',
      keyType: 'unshielded',
    });
    return result.signature;
  }

  async getAddress() {
    const addresses = await this.api.getShieldedAddresses();
    return {
      type: 'MIDNIGHT',
      address: addresses.shieldedAddress,
    };
  }
}

// Custom v4-compatible Midnight Connector
export class MidnightConnectorV4 {
  private static INSTANCE: MidnightConnectorV4 | undefined;
  providerWrapper: MidnightProviderWrapper | null = null;

  static instance(): MidnightConnectorV4 {
    if (MidnightConnectorV4.INSTANCE == null) {
      const newInstance = new MidnightConnectorV4();
      MidnightConnectorV4.INSTANCE = newInstance;
    }
    return MidnightConnectorV4.INSTANCE;
  }

  getOrThrowProvider(): MidnightProviderWrapper {
    if (this.providerWrapper == null) {
      throw new Error(`MidnightConnectorV4 provider isn't initialized yet`);
    }
    return this.providerWrapper;
  }

  getProvider(): MidnightProviderWrapper | null {
    return this.providerWrapper;
  }

  isConnected(): boolean {
    return this.providerWrapper != null;
  }

  // Get wallet options compatible with v4 API
  static getWalletOptions() {
    const midnight = typeof window !== 'undefined' ? window.midnight : {};
    if (midnight == null) {
      return [];
    }

    return Object.entries(midnight).map(([key, info]: [string, InitialAPI]) => ({
      metadata: {
        name: key,
        displayName: info.name,
        icon: info.icon,
      },
      api: async (networkId?: string) => {
        return await info.connect(networkId || MIDNIGHT_NETWORK_ID);
      },
    }));
  }

  async connectSimple(): Promise<MidnightProviderWrapper> {
    if (this.providerWrapper != null) {
      return this.providerWrapper;
    }
    const options = MidnightConnectorV4.getWalletOptions();
    if (options.length === 0) {
      throw new Error(`No Midnight wallet found`);
    }
    const v4Api = await options[0].api(MIDNIGHT_NETWORK_ID);
    this.providerWrapper = new MidnightProviderWrapper(v4Api, options[0].metadata);
    return this.providerWrapper;
  }

  async connectNamed(name: string): Promise<MidnightProviderWrapper> {
    const options = MidnightConnectorV4.getWalletOptions();
    const providerOption = options.find(entry => entry.metadata.name === name);
    if (providerOption == null) {
      throw new Error(`Midnight wallet ${name} not found`);
    }
    const v4Api = await providerOption.api(MIDNIGHT_NETWORK_ID);
    this.providerWrapper = new MidnightProviderWrapper(v4Api, providerOption.metadata);
    return this.providerWrapper;
  }

  async connectExternal(conn: { metadata: WalletOption; api: ConnectedAPI }): Promise<MidnightProviderWrapper> {
    this.providerWrapper = new MidnightProviderWrapper(conn.api, conn.metadata);
    return this.providerWrapper;
  }
}

async function midnightLoginV4(loginInfo: LoginInfo) {
  try {
    const connector = MidnightConnectorV4.instance();
    const providerWrapper = await connector.connectSimple();

    const walletAddress = (await providerWrapper.getAddress()).address;

    const metadata = connector.getProvider()?.metadata;

    const walletConnection: MidnightWalletConnection = {
      provider: providerWrapper.api,
      walletAddress,
      metadata: metadata || { name: 'Midnight', displayName: 'Midnight' },
    };

    return {
      success: true,
      result: walletConnection as any,
    };
  } catch (error) {
    console.error("Midnight wallet connection error:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [midnightWallet, setMidnightWallet] = useState<MidnightWalletConnection | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = () => {
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
  };

  const connectEvmWallet = async (loginInfo: LoginInfo) => {
    const response = await walletLogin(loginInfo);
    if (response.success) {
      setWallet(response.result);
      setAddress(response.result.walletAddress);
      setIsConnected(true);
      closeModal();
      console.log(
        "🔗 [WALLET] Wallet connected:",
        response.result.walletAddress,
      );
      return response;
    } else if (loginInfo.mode === 2) {
      const midnightResponse = await midnightLoginV4(loginInfo);
      if (midnightResponse.success && midnightResponse.result) {
        setMidnightWallet(midnightResponse.result);
        closeModal();
        console.log(
          "🔗 [WALLET] Midnight wallet connected:",
          midnightResponse.result.walletAddress,
        );
        return midnightResponse;
      } else {
        console.error("Failed to connect Midnight wallet:", midnightResponse.errorMessage);
        throw new Error(midnightResponse.errorMessage);
      }
    } else {
      console.error("Failed to connect wallet:", response.errorMessage);
      return response;
    }
  };

  const value: WalletContextType = {
    isConnected,
    address,
    wallet,
    midnightWallet,
    connectEvmWallet,
    isModalOpen,
    openModal,
    closeModal,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}
