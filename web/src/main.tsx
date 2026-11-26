import {createRoot} from 'react-dom/client';
import App from './app/App';
import { applyAccent, rememberedAccent } from './shared/content';
import './index.css';
import { BUILD_ID } from './shared/updates';

applyAccent(rememberedAccent());
createRoot(document.getElementById('root')!).render(<App />);

// Installable app: the service worker (web/public/sw.js) keeps the app's files and an offline page.
// Only in a built site: in `npm run dev` it would cache files that keep changing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // updateViaCache 'none': the browser always asks the server for sw.js, so a new one is found at once.
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { updateViaCache: 'none' }).catch(() => {
      /* not supported here (private window, old browser): the site works the same without it */
    });
  });
}
