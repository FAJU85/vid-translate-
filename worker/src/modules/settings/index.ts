/**
 * Settings brick: the values edited on the website's /admin page (name, logo, colour, main texts,
 * bot welcome), stored in D1 and protected by the ADMIN_PASSWORD secret.
 * This file is the brick's only public interface.
 */
export { SETTINGS_SCHEMA, type Settings } from './store';
export { handleAdminLogin, handleAdminSettings, publicSettings, serveLogo, welcomeOverride } from './handlers';
