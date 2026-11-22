/**
 * Shares brick: a public page (/v/<id>) for every finished video, its files kept in R2 (30 days
 * for free accounts, until deleted for monthly plans). Follows jobs through the listener port.
 * This file is the brick's only public interface.
 */
export { SHARES_SCHEMA, shareForJob, type ShareRow } from './store';
export { FREE_SHARE_SECONDS, deleteShare, shareUrl, sharesJobListener, sweepShares } from './service';
export { handleSharePage } from './page';
export { handleShares, publicShare, type ShareViewer } from './handlers';
