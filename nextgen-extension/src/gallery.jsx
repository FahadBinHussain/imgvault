/**
 * @fileoverview Gallery Entry Point
 * @version 2.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import GalleryPage from './pages/GalleryPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryPage />
  </React.StrictMode>
);
