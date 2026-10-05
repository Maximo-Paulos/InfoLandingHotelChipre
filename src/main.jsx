import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { protegerDomDelTraductor } from './idioma.js';
import './styles.css';

protegerDomDelTraductor();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
