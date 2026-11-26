import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import site from '../content/site.json';

// Read from the build environment (Cloudflare Workers Builds sets the commit).
declare const process: { env: Record<string, string | undefined> };

/**
 * This build's id: the commit Cloudflare builds (or the time). The app compares it with
 * /version.json to know a newer KAVOX is out, and registers /sw.js?v=<id>, so each deploy installs
 * a fresh service worker whose cache is named after it (no version to bump by hand).
 */
const BUILD_ID = (process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 12) || Date.now().toString(36);

function buildStamp(): Plugin {
  return {
    name: 'build-stamp',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) + '\n' });
    },
  };
}

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
      // The picture shown when a link to the site is shared (approved KAVOX assets).
      // The Worker turns these addresses into full ones (worker/src/index.ts) as it serves the page.
      const title = escapeHtml(site.seo?.title ?? '');
      const description = escapeHtml(site.seo?.description ?? '');
      const share = [
        `<meta property="og:type" content="website" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="/" />`,
        `<meta property="og:image" content="/assets/og-image.png" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:image" content="/assets/og-image.png" />`,
      ].join('\n    ');
      return html
        .replace('%SITE_TITLE%', escapeHtml(site.seo?.title ?? ''))
        .replace('%SITE_DESCRIPTION%', escapeHtml(site.seo?.description ?? ''))
        .replace('<!--SITE_ICON-->', `${icon}\n    ${share}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteHead(), buildStamp()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    // Without VITE_API_BASE the app calls /api on its own origin; in dev that is
    // forwarded to a local `wrangler dev` (see worker/).
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // The content files live in ../content, outside this folder.
    fs: { allow: ['..'] },
  },
});
