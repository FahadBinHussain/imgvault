/**
 * @fileoverview Main Entry Point with Router
 * @version 2.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import GalleryPage from './pages/GalleryPage';
import SettingsPage from './pages/SettingsPage';
import TrashPage from './pages/TrashPage';
import PopupPage from './pages/PopupPage';
import CollectionsPage from './pages/CollectionsPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/gallery" replace />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/gallery/:collectionId" element={<GalleryPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/popup" element={<PopupPage />} />
        <Route path="*" element={<Navigate to="/gallery" replace />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
