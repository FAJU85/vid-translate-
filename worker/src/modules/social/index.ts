/**
 * Social brick: KAVOX as a place to post translated and dubbed videos. Each signed-in account can
 * claim a unique @handle with a public profile page (/@handle) listing the videos it posted;
 * people like videos, follow creators, and watch a feed ("For you" and "Following").
 * This file is the brick's only public interface.
 */
export { SOCIAL_SCHEMA } from './store';
export { HANDLE, checkHandle } from './handles';
export { creatorFor, handleSocial } from './handlers';
export { handleFeed, rank } from './feed';
export { PROFILE_PATH, handleProfilePage } from './page';
