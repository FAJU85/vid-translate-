/**
 * Social brick: KAVOX as a place to post translated and dubbed videos. Each signed-in account can
 * claim a unique @handle with a public profile page (/@handle) listing the videos it posted;
 * people like videos, follow creators, comment, report, watch a feed ("For you" and "Following"),
 * and get notifications (on the site, and by the Telegram bot if they want).
 * This file is the brick's only public interface.
 */
export { SOCIAL_SCHEMA } from './store';
export { HANDLE, checkHandle } from './handles';
export { creatorFor, handleSocial } from './handlers';
export { handleFeed, rank } from './feed';
export { handleComments, handleModeration } from './moderation';
export { handleNotifications, notifyPost, sweepNotifications } from './notifications';
export { PROFILE_PATH, handleProfilePage } from './page';
