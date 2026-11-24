/**
 * Shares brick: a public page (/<id>) for every finished video, its files kept in R2 (30 days
 * for free accounts, until deleted for monthly plans). Follows jobs through the listener port.
 * This file is the brick's only public interface.
 */
export { SHARES_COLUMNS, SHARES_SCHEMA, getPostedVideo, listPostedVideos, listPublicShares, listShares, publicTotals, shareForJob, shareTotals, type ShareRow, type Visibility } from './store';
export { FREE_SHARE_SECONDS, creatorOf, deleteShare, registerCreatorLookup, shareUrl, sharesJobListener, sweepShares, type CreatorLookup } from './service';
export { SHORT_PATH, handleSharePage } from './page';
export { handleShares, publicShare, type ShareViewer } from './handlers';
