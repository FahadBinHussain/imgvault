/**
 * @fileoverview Settings Entry Point
 * @version 2.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsPage from './pages/SettingsPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>
);
