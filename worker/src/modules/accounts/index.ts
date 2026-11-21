/**
 * Accounts brick: who someone is (Telegram, an email link, Google, or a guest browser) and their
 * credits (1 credit = 60 seconds of video). This file is the brick's only public interface.
 */
export { ACCOUNTS_SCHEMA, type Account } from './store';
export { confirmTelegramLogin } from './auth';
export { SECONDS_PER_CREDIT, balance, costSeconds, creditsEnabled, grant, type Balance } from './credits';
export { billingListener, chargeJob, estimateSeconds, type ChargeResult } from './billing';
export { accountForTelegram, accountForWeb, handleAccounts, type AccountsContext } from './handlers';
