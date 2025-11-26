/**
 * @fileoverview Trash Entry Point
 * @version 2.0.0
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import TrashPage from './pages/TrashPage';
import './index.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <TrashPage />
  </React.StrictMode>
);
