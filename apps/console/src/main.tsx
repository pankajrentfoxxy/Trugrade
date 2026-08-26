import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BRAND } from '@trugrade/config/brand';
import { App } from './App';
import './index.css';

// The one place the brand name reaches the console. Everything else reads BRAND,
// so a rename is a single edit rather than a grep across two apps.
document.title = `${BRAND.name} Console`;

const root = document.getElementById('root');
if (!root) throw new Error('No #root element — index.html and main.tsx disagree.');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
