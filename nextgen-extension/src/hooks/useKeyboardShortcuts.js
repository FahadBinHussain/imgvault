/**
 * @fileoverview Keyboard Shortcuts Hook
 * @description Global keyboard shortcut management for ImgVault
 */

import { useEffect, useRef } from 'react';

/**
 * Hook for handling keyboard shortcuts
 * @param {Object} shortcuts - Map of key combinations to handlers
 * @param {boolean} enabled - Whether shortcuts are enabled
 * @param {Array} deps - Dependencies for the effect
 */
export function useKeyboardShortcuts(shortcuts, enabled = true, deps = []) {
  const handlersRef = useRef(shortcuts);
  
  // Update handlers ref when shortcuts change
  useEffect(() => {
    handlersRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        return;
      }

      // Build key combination string
      const modifiers = [];
      if (e.ctrlKey) modifiers.push('ctrl');
      if (e.altKey) modifiers.push('alt');
      if (e.shiftKey) modifiers.push('shift');
      if (e.metaKey) modifiers.push('meta');
      
      const key = e.key.toLowerCase();
      const combo = [...modifiers, key].join('+');

      // Check for exact match
      if (handlersRef.current[combo]) {
        e.preventDefault();
        e.stopPropagation();
        handlersRef.current[combo](e);
        return;
      }

      // Check for key-only match (no modifiers)
      if (modifiers.length === 0 && handlersRef.current[key]) {
        e.preventDefault();
        e.stopPropagation();
        handlersRef.current[key](e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, ...deps]);
}

/**
 * Common keyboard shortcut presets
 */
export const SHORTCUTS = {
  // Navigation
  ARROW_LEFT: 'arrowleft',
  ARROW_RIGHT: 'arrowright',
  ARROW_UP: 'arrowup',
  ARROW_DOWN: 'arrowdown',
  
  // Actions
  ESCAPE: 'escape',
  ENTER: 'enter',
  SPACE: ' ',
  DELETE: 'delete',
  BACKSPACE: 'backspace',
  
  // Modifiers with keys
  CTRL_S: 'ctrl+s',
  CTRL_F: 'ctrl+f',
  CTRL_K: 'ctrl+k',
  CTRL_N: 'ctrl+n',
  CTRL_E: 'ctrl+e',
  CTRL_D: 'ctrl+d',
  
  // Common keys
  F: 'f',
  G: 'g',
  H: 'h',
  I: 'i',
  N: 'n',
  P: 'p',
  S: 's',
  T: 't',
  U: 'u',
  Q: 'q',
  SLASH: '/',
  QUESTION: '?',
};

/**
 * Hook for showing keyboard shortcut help
 * @returns {Object} Help modal state and functions
 */
export function useKeyboardShortcutsHelp(shortcuts) {
  // This would integrate with a help modal component
  // For now, just console.log available shortcuts
  useEffect(() => {
    console.log('📋 Available keyboard shortcuts:', shortcuts);
  }, []);
  
  return {
    showHelp: () => {
      console.table(shortcuts);
      alert('Keyboard Shortcuts:\n\n' + 
        Object.entries(shortcuts).map(([key, handler]) => 
          `${key.toUpperCase()}: ${handler.name || 'Action'}`
        ).join('\n')
      );
    }
  };
}
