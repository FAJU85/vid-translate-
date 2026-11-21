import type { Env } from '../../shared/env';

/**
 * What can be bought (the website's Pricing tab shows the same): packs of credits that never
 * expire, and monthly plans whose credits last one month and are replaced at each renewal.
 * Prices are in US cents; in Telegram they are converted to Stars (STARS_PER_USD, 50 by default:
 * close to what a person pays for Stars in the app).
 */
export interface Product {
  id: ProductId;
  kind: 'pack' | 'plan';
  name: string;
  credits: number;
  cents: number;
}

export type ProductId = 'pack15' | 'pack40' | 'starter' | 'pro' | 'business';

export const PRODUCTS: Record<ProductId, Product> = {
  pack15: { id: 'pack15', kind: 'pack', name: '15 credits', credits: 15, cents: 700 },
  pack40: { id: 'pack40', kind: 'pack', name: '40 credits', credits: 40, cents: 1600 },
  starter: { id: 'starter', kind: 'plan', name: 'Starter plan', credits: 30, cents: 900 },
  pro: { id: 'pro', kind: 'plan', name: 'Pro plan', credits: 150, cents: 2900 },
  business: { id: 'business', kind: 'plan', name: 'Business plan', credits: 600, cents: 7900 },
};

export const isProduct = (id: unknown): id is ProductId => typeof id === 'string' && id in PRODUCTS;

/** A plan's month, as Telegram requires for subscriptions (30 days). */
export const PLAN_PERIOD = 30 * 86400;

export function starsPrice(env: Env, product: Product): number {
  const perUsd = Number(env.STARS_PER_USD) > 0 ? Number(env.STARS_PER_USD) : 50;
  return Math.max(1, Math.round((product.cents / 100) * perUsd));
}
