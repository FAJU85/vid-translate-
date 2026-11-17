import {createRoot} from 'react-dom/client';
import App from './app/App';
import { applyAccent, rememberedAccent } from './shared/content';
import './index.css';

applyAccent(rememberedAccent());
createRoot(document.getElementById('root')!).render(<App />);
