const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isValidEvmAddress(address: string | undefined): address is string {
  return typeof address === 'string' && EVM_ADDRESS_RE.test(address.trim());
}

export async function jsonRpcCall<T = string>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const res = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status} from ${rpcUrl}`);
  }

  const data = (await res.json()) as { result?: T; error?: { message?: string } };
  if (data.error) {
    throw new Error(data.error.message ?? 'Unknown RPC error');
  }
  if (data.result === undefined) {
    throw new Error('Empty RPC result');
  }
  return data.result;
}

export function hexWeiToGwei(hexWei: string): number {
  const wei = BigInt(hexWei);
  return Number(wei) / 1e9;
}

export function hexToNumber(hexVal: string): number {
  return Number(BigInt(hexVal));
}

export function hexWeiToEth(hexWei: string): string {
  const wei = BigInt(hexWei);
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${frac}`;
}
