import { hmacHex, safeEqual } from '../../shared/crypto';
import { now, type Env } from '../../shared/env';
import { PLAN_PERIOD, PRODUCTS, isProduct, type Product, type ProductId } from './products';
import type { Account } from './store';

export const PAYMENTS_SCHEMA = [
  // One row per payment (Stripe checkout or invoice, Telegram Stars charge): it is what makes a
  // payment count once, however often its notice arrives.
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS payments_account ON payments (account_id, created_at)`,
];

export interface Payment {
  /** Unique per payment, prefixed by provider: "stripe:in_…", "stars:<charge id>". */
  id: string;
  provider: 'stripe' | 'stars';
  accountId: string;
  product: ProductId;
  amount: number;
  currency: string;
  /** Plans: when this month's credits end (else a month from now). */
  periodEnd?: number | null;
}

/**
 * Give what was bought, once: a pack adds credits that never expire; a plan sets this month's
 * credits (replacing what was left of last month's, which do not carry over). Returns false when
 * this payment was already counted.
 */
export async function fulfil(env: Env, p: Payment): Promise<boolean> {
  const product = PRODUCTS[p.product];
  const ts = now();
  const seconds = product.credits * 60;
  const credit =
    product.kind === 'pack'
      ? // Bought credits never expire; added to what is there.
        env.DB.prepare(
          `INSERT INTO credit_buckets (account_id, bucket, seconds, expires_at) VALUES (?1, 'topup', ?2, NULL)
           ON CONFLICT (account_id, bucket) DO UPDATE SET seconds = seconds + ?2, expires_at = NULL`,
        ).bind(p.accountId, seconds)
      : // This month's plan credits replace last month's. A day of grace after the period, so a
        // renewal that arrives a little late does not leave a gap. An older invoice arriving after a
        // newer one (Stripe does not promise the order) is recorded but changes nothing.
        env.DB.prepare(
          `INSERT INTO credit_buckets (account_id, bucket, seconds, expires_at) VALUES (?1, 'monthly', ?2, ?3)
           ON CONFLICT (account_id, bucket) DO UPDATE SET seconds = ?2, expires_at = ?3
           WHERE credit_buckets.expires_at IS NULL OR credit_buckets.expires_at <= ?3`,
        ).bind(p.accountId, seconds, (p.periodEnd ?? ts + PLAN_PERIOD) + 86400);
  try {
    // One transaction: the payment row, the credits and the ledger line, or none of them. The same
    // payment twice fails on the payment's id, and nothing is given again.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO payments (id, provider, account_id, product, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        p.id,
        p.provider,
        p.accountId,
        p.product,
        p.amount,
        p.currency,
        ts,
      ),
      credit,
      // Only when the credits were given (changes() is the statement just before).
      env.DB.prepare("INSERT INTO credit_ledger (account_id, job_id, kind, seconds, detail, created_at) SELECT ?, NULL, 'grant', ?, ?, ? WHERE changes() > 0").bind(
        p.accountId,
        seconds,
        `${product.kind === 'pack' ? 'topup' : 'monthly'}: ${product.name} (${p.provider})`,
        ts,
      ),
    ]);
    return true;
  } catch (err) {
    const seen = await env.DB.prepare('SELECT 1 FROM payments WHERE id = ?').bind(p.id).first();
    if (seen) return false; // already counted (the same notice again)
    throw err; // a real failure: the provider will send the notice again
  }
}

// ------------------------------------------------------------------ Stripe (cards, on the website)

export const stripeConfigured = (env: Env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

async function stripe<T = any>(env: Env, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

/** A Stripe Checkout page for one product; returns its URL. Credits are given by the webhook. */
export async function createCheckout(env: Env, origin: string, account: Account, product: Product): Promise<string> {
  const plan = product.kind === 'plan';
  const form: Record<string, string> = {
    mode: plan ? 'subscription' : 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(product.cents),
    'line_items[0][price_data][product_data][name]': `${product.name} — ${product.credits} credits${plan ? ' a month' : ''}`,
    success_url: `${origin}/?paid=1`,
    cancel_url: `${origin}/?tab=pricing`,
    client_reference_id: account.id,
    'metadata[account_id]': account.id,
    'metadata[product]': product.id,
  };
  if (plan) {
    form['line_items[0][price_data][recurring][interval]'] = 'month';
    // On the subscription too, so every renewal's invoice says whose it is and what it is for.
    form['subscription_data[metadata][account_id]'] = account.id;
    form['subscription_data[metadata][product]'] = product.id;
  }
  // The same Stripe customer every time, so all of a person's plans show in one "Manage subscription".
  if (account.stripe_customer) form.customer = account.stripe_customer;
  else if (account.email && account.email_verified) form.customer_email = account.email;
  const session = await stripe<{ url: string }>(env, 'POST', 'checkout/sessions', form);
  return session.url;
}

/** Check a Stripe-Signature header (t=…,v1=…) against the raw body, within five minutes. */
async function verifyStripe(env: Env, header: string, raw: string): Promise<boolean> {
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now() - Number(t)) > 300) return false;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET!, `${t}.${raw}`);
  return sigs.some((s) => safeEqual(s, expected));
}

/** A subscription's metadata, from the invoice when it carries it, else from Stripe. */
async function subscriptionMeta(env: Env, invoice: any): Promise<Record<string, string> | null> {
  const fromInvoice = invoice.parent?.subscription_details?.metadata ?? invoice.subscription_details?.metadata;
  if (fromInvoice?.account_id) return fromInvoice;
  const id = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (typeof id !== 'string') return null;
  return (await stripe<{ metadata: Record<string, string> }>(env, 'GET', `subscriptions/${id}`)).metadata ?? null;
}

/**
 * POST /api/stripe/webhook. A one-off purchase is fulfilled when its checkout completes; a plan on
 * every paid invoice (the first month and each renewal).
 */
export async function handleStripeWebhook(env: Env, request: Request): Promise<Response> {
  if (!stripeConfigured(env)) return new Response('not configured', { status: 404 });
  const raw = await request.text();
  if (!(await verifyStripe(env, request.headers.get('Stripe-Signature') ?? '', raw))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(raw) as { type: string; data: { object: any } };
  const obj = event.data.object;
  // Remember who the Stripe customer is, for "Manage subscription".
  if (event.type === 'checkout.session.completed' && obj.customer && obj.metadata?.account_id) {
    await env.DB.prepare('UPDATE accounts SET stripe_customer = ? WHERE id = ?').bind(obj.customer, obj.metadata.account_id).run();
  }
  // A payment method that takes time (a bank debit) completes "unpaid" and succeeds later.
  const checkoutDone = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  if (checkoutDone && obj.mode === 'payment' && obj.payment_status === 'paid') {
    const product = obj.metadata?.product;
    if (isProduct(product) && obj.metadata?.account_id) {
      await fulfil(env, {
        id: `stripe:${obj.id}`,
        provider: 'stripe',
        accountId: obj.metadata.account_id,
        product,
        amount: obj.amount_total ?? 0,
        currency: obj.currency ?? 'usd',
      });
    }
  } else if (event.type === 'invoice.paid' && obj.amount_paid > 0) {
    const meta = await subscriptionMeta(env, obj);
    if (meta?.account_id && isProduct(meta.product)) {
      await fulfil(env, {
        id: `stripe:${obj.id}`,
        provider: 'stripe',
        accountId: meta.account_id,
        product: meta.product,
        amount: obj.amount_paid,
        currency: obj.currency ?? 'usd',
        periodEnd: obj.lines?.data?.[0]?.period?.end ?? null,
      });
    }
  }
  return new Response('ok');
}

/** Stripe's page where a card subscriber cancels or changes their plan and sees invoices. */
export async function createPortal(env: Env, origin: string, account: Account): Promise<string | null> {
  if (!account.stripe_customer) return null;
  const session = await stripe<{ url: string }>(env, 'POST', 'billing_portal/sessions', {
    customer: account.stripe_customer,
    return_url: `${origin}/?tab=pricing`,
  });
  return session.url;
}
