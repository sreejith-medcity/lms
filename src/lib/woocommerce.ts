import { resolveIntegration } from '@/lib/integration-store';

/**
 * Reading the old store.
 *
 * Read-only on purpose. While both systems are running, WooCommerce is the
 * record for anything sold there, and a migration tool that writes back is a
 * migration tool that can corrupt the thing it is copying from. If something
 * needs changing on that side, a person does it there.
 *
 * The REST API is paged and slow on shared hosting, so everything here takes a
 * page at a time and the caller decides when to stop.
 */

export interface WooClient {
  get<T>(path: string, params?: Record<string, string | number>): Promise<T>;
  siteUrl: string;
}

export class WooError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WooError';
  }
}

export async function wooFor(organizationId: string): Promise<WooClient | null> {
  const resolved = await resolveIntegration(organizationId, 'woocommerce');
  if (!resolved?.complete) return null;

  const siteUrl = resolved.values.siteUrl.replace(/\/$/, '');
  const auth = Buffer.from(
    `${resolved.values.consumerKey}:${resolved.values.consumerSecret}`,
  ).toString('base64');

  return {
    siteUrl,
    async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
      const url = new URL(`${siteUrl}/wp-json/wc/v3${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }

      const response = await fetch(url, {
        headers: { authorization: `Basic ${auth}` },
        cache: 'no-store',
        // Shared hosting under load, and a page of a hundred orders. Generous,
        // but not so generous that a scheduled run hangs on it.
        signal: AbortSignal.timeout(25_000),
      });

      if (response.status === 401) {
        throw new WooError(
          'WooCommerce refused the keys. Check they have read access and that permalinks are not set to plain.',
          401,
        );
      }
      if (response.status === 404) {
        throw new WooError(
          'That endpoint was not found. If permalinks are set to plain, the WooCommerce REST routes do not exist.',
          404,
        );
      }
      if (!response.ok) {
        throw new WooError(`WooCommerce answered ${response.status}.`, response.status);
      }

      return (await response.json()) as T;
    },
  };
}

export interface WooCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  date_created: string;
  billing?: { phone?: string; city?: string; state?: string };
}

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  status: string;
  price: string;
  regular_price: string;
  permalink: string;
  categories?: { id: number; name: string; slug: string }[];
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  date_created: string;
  date_paid: string | null;
  payment_method_title?: string;
  customer_id: number;
  billing?: { email?: string; phone?: string; first_name?: string; last_name?: string };
  line_items?: { id: number; name: string; product_id: number; total: string; quantity: number }[];
}

export async function customers(client: WooClient, page: number, perPage = 50) {
  return client.get<WooCustomer[]>('/customers', { page, per_page: perPage, orderby: 'id', order: 'asc' });
}

export async function products(client: WooClient, page: number, perPage = 50) {
  return client.get<WooProduct[]>('/products', { page, per_page: perPage, orderby: 'id', order: 'asc' });
}

export async function orders(client: WooClient, page: number, perPage = 50) {
  return client.get<WooOrder[]>('/orders', { page, per_page: perPage, orderby: 'id', order: 'asc' });
}

/** A quick call that proves the credentials work without pulling anything real. */
export async function checkConnection(client: WooClient): Promise<string> {
  const one = await client.get<WooProduct[]>('/products', { per_page: 1 });
  return `Connected. The store answered, and it has at least ${one.length} product visible to these keys.`;
}
