import type { Env } from '../../shared/env';
import {
  PLAN_PERIOD,
  PRODUCTS,
  accountForTelegram,
  creditsEnabled,
  freshBalance,
  fulfil,
  isProduct,
  starsPrice,
  type ProductId,
} from '../accounts';
import { sendMessage, tg, type Keyboard } from './api';
import { t, type UiLang } from './i18n';

/**
 * Payments in the bot with Telegram Stars (Telegram's own currency for digital goods: no account
 * to set up). A pack is an invoice in the chat; a plan is a Stars subscription link (renewed by
 * Telegram every 30 days). The payload names the product and the account, and every Stars charge
 * is counted once (accounts brick: fulfil).
 */

/** The /buy menu: packs, then plans, with their price in Stars. */
export function buyMenu(env: Env, ui: UiLang): { text: string; keyboard: Keyboard } {
  const button = (id: ProductId) => {
    const p = PRODUCTS[id];
    const label = p.kind === 'plan' ? t(ui, 'buy_plan_button', { name: p.name, credits: p.credits }) : t(ui, 'buy_pack_button', { credits: p.credits });
    return { text: `${label} · ⭐ ${starsPrice(env, p)}`, callback_data: `buy:${id}` };
  };
  return {
    text: t(ui, 'buy_menu'),
    keyboard: [[button('pack15'), button('pack40')], [button('starter')], [button('pro')], [button('business')]],
  };
}

/** Send the way to pay for one product: an invoice (pack) or a subscription link (plan). */
export async function sendStarsInvoice(env: Env, chatId: number, userId: number, ui: UiLang, product: ProductId): Promise<void> {
  if (!creditsEnabled(env)) {
    await sendMessage(env, chatId, t(ui, 'balance_free'));
    return;
  }
  const p = PRODUCTS[product];
  const account = await accountForTelegram(env, userId);
  const payload = `${product}:${account.id}`;
  const price = [{ label: p.name, amount: starsPrice(env, p) }];
  const description = t(ui, p.kind === 'plan' ? 'buy_plan_description' : 'buy_pack_description', { credits: p.credits });
  if (p.kind === 'pack') {
    // With a start parameter, a forwarded copy opens the bot (its own invoice) instead of paying this one.
    await tg(env, 'sendInvoice', { chat_id: chatId, title: p.name, description, payload, currency: 'XTR', prices: price, start_parameter: `buy_${product}` });
    return;
  }
  const link = await tg<string>(env, 'createInvoiceLink', {
    title: p.name,
    description,
    payload,
    currency: 'XTR',
    prices: price,
    subscription_period: PLAN_PERIOD,
  });
  if (link) await sendMessage(env, chatId, t(ui, 'buy_plan_link', { name: p.name }), [[{ text: t(ui, 'btn_subscribe'), url: link }]]);
}

const parsePayload = (payload: unknown) => {
  const [product, accountId] = String(payload ?? '').split(':');
  return isProduct(product) && accountId ? { product, accountId } : null;
};

/** Telegram asks before charging: accept only what this bot sells, in Stars, at today's price. */
export async function answerPreCheckout(env: Env, query: any): Promise<void> {
  const parsed = parsePayload(query.invoice_payload);
  // Only the person the invoice was made for can pay it (the credits go to that account), and only
  // while credits are on.
  const buyer = parsed && query.from?.id ? await accountForTelegram(env, query.from.id) : null;
  const ok = Boolean(
    parsed &&
      creditsEnabled(env) &&
      buyer?.id === parsed.accountId &&
      query.currency === 'XTR' &&
      query.total_amount === starsPrice(env, PRODUCTS[parsed.product]),
  );
  await tg(env, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok,
    ...(ok ? {} : { error_message: 'This offer has changed. Please open /buy again.' }),
  });
}

/** Paid (or a plan renewed): give the credits, once, and say what the balance is now. */
export async function handleSuccessfulPayment(env: Env, msg: any, ui: UiLang): Promise<void> {
  const pay = msg.successful_payment;
  const parsed = parsePayload(pay?.invoice_payload);
  if (!parsed || !pay.telegram_payment_charge_id) return;
  await fulfil(env, {
    id: `stars:${pay.telegram_payment_charge_id}`,
    provider: 'stars',
    accountId: parsed.accountId,
    product: parsed.product,
    amount: pay.total_amount ?? 0,
    currency: 'XTR',
    periodEnd: pay.subscription_expiration_date ?? null,
  });
  const account = await accountForTelegram(env, msg.from?.id ?? msg.chat.id);
  const total = (await freshBalance(env, account)).total_seconds;
  await sendMessage(env, msg.chat.id, t(ui, 'paid_ok', { credits: (total / 60).toFixed(2) }));
}
