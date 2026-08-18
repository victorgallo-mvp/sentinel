import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { instalarInterceptadorDemo } from './demo/mockApi.js';

// Sem efeito nenhum fora do modo demonstração (?token=demo): só intercepta
// chamadas de rede quando esse token específico é usado.
instalarInterceptadorDemo();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
