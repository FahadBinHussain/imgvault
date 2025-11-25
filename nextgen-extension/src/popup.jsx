/**
 * @fileoverview Popup Entry Point
 * @version 2.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupPage from './pages/PopupPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PopupPage />
  </React.StrictMode>
);
