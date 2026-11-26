/**
 * Shares brick: a public page (/<id>) for every finished video, its files kept in R2 until
 * their owner deletes them (KAVOX never deletes a video by itself). Follows jobs through the listener port.
 * This file is the brick's only public interface.
 */
export { SHARES_COLUMNS, SHARES_SCHEMA, countView, getOwnShare, getPostedVideo, getShare, takeDownShare, likeEscape, listPostedVideos, listPublicShares, listShares, publicTotals, searchPostedVideos, shareForJob, shareTotals, viewerLang, viewsSince, type ShareRow, type Visibility } from './store';
export { creatorOf, deleteShare, registerCreatorLookup, registerPostListener, shareUrl, sharesJobListener, sweepShares, type CreatorLookup, type PostListener } from './service';
export { SHORT_PATH, handleSharePage } from './page';
export { handleShares, publicShare, type ShareViewer } from './handlers';
export { eraseShares, exportShares } from './personal';
