/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODE: string;
  readonly VITE_MIDNIGHT_NETWORK_ID: string;
  readonly VITE_MIDNIGHT_INDEXER_HTTP: string;
  readonly VITE_MIDNIGHT_INDEXER_WS: string;
  readonly VITE_MIDNIGHT_NODE_HTTP: string;
  readonly VITE_MIDNIGHT_PROOF_SERVER_URL: string;
}
