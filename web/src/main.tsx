import {createRoot} from 'react-dom/client';
import App from './app/App';
import { applyAccent, rememberedAccent } from './shared/content';
import './index.css';

applyAccent(rememberedAccent());
createRoot(document.getElementById('root')!).render(<App />);

// Installable app: the service worker (web/public/sw.js) keeps the app's files and an offline page.
// Only in a built site: in `npm run dev` it would cache files that keep changing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not supported here (private window, old browser): the site works the same without it */
    });
  });
}
