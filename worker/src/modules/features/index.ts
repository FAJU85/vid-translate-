/**
 * Features brick: switch features on from the /admin page (credits, sign-in methods, card
 * payments, limits, two-step sign-in) instead of the command line. Saved values fill the Worker
 * settings of the same names; settings on the server always win. Keys are stored encrypted.
 * This file is the brick's only public interface.
 */
export { FEATURES_SCHEMA, withFeatures } from './store';
export { handleFeatures } from './handlers';
