export interface AppBindings {
  PAYEE_WALLET: string;
  X402_NETWORK: string;
  X402_FACILITATOR_URL: string;
  SERVICE_NAME: string;
  SERVICE_URL: string;
}

export interface EndpointSpec {
  path: string;
  method: 'GET';
  priceUsd: string;
  summary: string;
  description: string;
  tags: string[];
  queryParams: Record<
    string,
    {
      type: string;
      required: boolean;
      description: string;
      example?: string;
    }
  >;
  outputSchema: Record<string, unknown>;
}

export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const DEFAULT_NETWORK = 'eip155:8453';
