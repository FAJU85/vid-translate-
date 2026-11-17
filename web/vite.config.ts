import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import site from '../content/site.json';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Page title, description and default tab icon come from content/site.json (the defaults; the
 * name, logo and colour saved on the /admin page are applied in the browser).
 * Read when the build starts; in `npm run dev`, restart after editing it.
 */
function siteHead(): Plugin {
  return {
    name: 'site-head',
    transformIndexHtml(html) {
      const icon = site.brand?.logo
        ? `<link rel="icon" href="${escapeHtml(site.brand.logo)}" />`
        : '';
      return html
        .replace('%SITE_TITLE%', escapeHtml(site.seo?.title ?? ''))
        .replace('%SITE_DESCRIPTION%', escapeHtml(site.seo?.description ?? ''))
        .replace('<!--SITE_ICON-->', icon);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteHead()],
  server: {
    // Without VITE_API_BASE the app calls /api on its own origin; in dev that is
    // forwarded to a local `wrangler dev` (see worker/).
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // The content files live in ../content, outside this folder.
    fs: { allow: ['..'] },
  },
});
