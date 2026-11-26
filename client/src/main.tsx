import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reloadOnceForNewBuild } from './components/LazyBoundary';

// O host foi atualizado com a aba aberta e um arquivo antigo da interface sumiu: recarrega uma vez.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForNewBuild()) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
