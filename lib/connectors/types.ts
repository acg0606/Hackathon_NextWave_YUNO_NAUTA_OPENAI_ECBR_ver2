export type TruthClassification =
  | 'HISTORICAL_FACT'
  | 'LIVE_CURRENT_CONTEXT'
  | 'EXTERNAL_SANDBOX'
  | 'SIMULATED_IF_TODAY'
  | 'MOCK_CONNECTOR'
  | 'UNKNOWN';

export type ConnectorEnvelope<T> = {
  connector: 'YUNO' | 'NAUTA' | 'NASA_EONET' | 'AISSTREAM' | 'ADSB_LOL';
  classification: TruthClassification;
  status: 'available' | 'stale' | 'unavailable';
  fetchedAt: string;
  expiresAt?: string;
  data: T | null;
  publicNote: string;
};
