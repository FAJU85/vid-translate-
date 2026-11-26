/**
 * Accounts brick: who someone is (Telegram, an email link, Google, or a guest browser) and their
 * credits (1 credit = 60 seconds of video). This file is the brick's only public interface.
 */
export { ACCOUNTS_COLUMNS, ACCOUNTS_SCHEMA, getAccount, recordConsent, type Account } from './store';
export { cancelTelegramLogin, confirmTelegramLogin, describeTelegramLogin, sweepSignIns } from './auth';
export { SECONDS_PER_CREDIT, balance, costSeconds, creditsEnabled, grant, grantStatements, guardChanged, type Balance } from './credits';
export { billingListener, chargeJob, checkJob, estimateSeconds, releaseJob, type ChargeResult, type Refusal } from './billing';
export { DAILY_SECONDS, FREE_MAX_VIDEO_SECONDS, freshBalance } from './allowances';
export { accountForTelegram, accountForWeb, existingTelegramAccount, handleAccounts, signedInAccount, type AccountsContext } from './handlers';
export { PRODUCTS, PLAN_PERIOD, isProduct, starsPrice, type Product, type ProductId } from './products';
export { chooseOutro, hasPlan, jobAccount } from './outro';
export { PAYMENTS_SCHEMA, createCheckout, fulfil, handleStripeWebhook, stripeConfigured } from './payments';
export { eraseAccount, exportAccount, personFor, renameAccount } from './personal';
