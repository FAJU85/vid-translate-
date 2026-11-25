/**
 * Settings brick: the values edited on the website's /admin page (name, logo, colour, main texts,
 * bot welcome), stored in D1 and protected by the ADMIN_PASSWORD secret.
 * This file is the brick's only public interface.
 */
export { LOGO_SIZE, SETTINGS_SCHEMA, logoSize, type Settings } from './store';
export { handleTermsPage } from './terms';
export { LEGAL_VERSION, handlePrivacyPage } from './privacy';
export { handleAdminSettings, instanceId, logoKind, lyricsLogo, publicOrigin, publicSettings, serveInstance, serveLogo, welcomeOverride } from './handlers';
export { ADMIN_AUTH_SCHEMA, TOTP_UNREADABLE, handleAdminLogin, isAdmin, makeToken as issueAdminToken, totpOk } from './admin-auth';
