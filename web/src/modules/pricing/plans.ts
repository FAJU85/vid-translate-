/**
 * Plans and credit packs (1 credit = 1 minute of video; dubbing 2 per minute). Prices are shown
 * here; payments come in the next step, so the buttons say so for now.
 */
export interface Plan {
  id: 'starter' | 'pro' | 'business';
  name: string;
  price: number;
  credits: number;
  best?: boolean;
}

export const PLANS: Plan[] = [
  { id: 'starter', name: 'Starter', price: 9, credits: 30 },
  { id: 'pro', name: 'Pro', price: 29, credits: 150, best: true },
  { id: 'business', name: 'Business', price: 79, credits: 600 },
];

export const PACKS = [
  { id: 'pack15', credits: 15, price: 7 },
  { id: 'pack40', credits: 40, price: 16 },
];

export const perCredit = (price: number, credits: number) => `$${(price / credits).toFixed(2)}`;
