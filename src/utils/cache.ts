/**
 * Cloudflare Workers edge-cache helper using `caches.default`.
 * Falls back transparently to direct execution in Node/Vitest environments.
 */
export async function withEdgeCache<T>(
  cacheKeyUrl: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
  cacheStore: Cache | undefined = typeof caches !== 'undefined'
    ? (caches as unknown as { default?: Cache }).default
    : undefined,
): Promise<{ data: T; cacheHit: boolean }> {
  if (!cacheStore) {
    return { data: await compute(), cacheHit: false };
  }

  const req = new Request(cacheKeyUrl, { method: 'GET' });
  const cached = await cacheStore.match(req);
  if (cached) {
    const data = (await cached.json()) as T;
    return { data, cacheHit: true };
  }

  const data = await compute();
  const res = new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${ttlSeconds}`,
    },
  });
  await cacheStore.put(req, res);
  return { data, cacheHit: false };
}
