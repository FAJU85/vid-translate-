import {createRoot} from 'react-dom/client';
import App from './app/App';
import { applyAccent } from './shared/content';
import './index.css';

applyAccent();
createRoot(document.getElementById('root')!).render(<App />);
