/**
 * @fileoverview Reusable UI Components
 * @version 2.0.0
 */

import React from 'react';
import clsx from 'clsx';

/**
 * Button component
 */
export const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md',
  className,
  ...props 
}) => {
  const variants = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white',
    secondary: 'bg-secondary-500 hover:bg-secondary-600 text-white',
    glass: 'glass-button text-white',
    outline: 'border-2 border-white/30 hover:border-white/50 text-white bg-transparent'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  return (
    <button
      className={clsx(
        'rounded-lg font-medium transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary-400',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

/**
 * Input component
 */
export const Input = ({ 
  label, 
  error,
  className,
  ...props 
}) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-slate-200 mb-2">
          {label}
        </label>
      )}
      <input
        className={clsx(
          'w-full px-4 py-2 rounded-lg',
          'bg-white/10 border border-white/20',
          'text-white placeholder-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent',
          'transition-all duration-200',
          error && 'border-red-400',
          className
        )}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-400">{error}</p>
      )}
    </div>
  );
};

/**
 * Textarea component
 */
export const Textarea = ({ 
  label, 
  error,
  className,
  ...props 
}) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-slate-200 mb-2">
          {label}
        </label>
      )}
      <textarea
        className={clsx(
          'w-full px-4 py-2 rounded-lg',
          'bg-white/10 border border-white/20',
          'text-white placeholder-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent',
          'transition-all duration-200 resize-none',
          error && 'border-red-400',
          className
        )}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-400">{error}</p>
      )}
    </div>
  );
};

/**
 * Card component
 */
export const Card = ({ children, className, ...props }) => {
  return (
    <div
      className={clsx(
        'glass-card rounded-xl p-6',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

/**
 * IconButton component
 */
export const IconButton = ({ 
  icon: Icon, 
  title,
  className,
  ...props 
}) => {
  return (
    <button
      title={title}
      className={clsx(
        'p-2 rounded-lg',
        'glass-button',
        'transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary-400',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="w-5 h-5" />}
    </button>
  );
};

/**
 * Badge component
 */
export const Badge = ({ children, variant = 'default', className }) => {
  const variants = {
    default: 'bg-slate-500/30 text-slate-200',
    primary: 'bg-primary-500/30 text-primary-200',
    success: 'bg-green-500/30 text-green-200',
    error: 'bg-red-500/30 text-red-200'
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};

/**
 * Spinner component
 */
export const Spinner = ({ size = 'md', className }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-2 border-white/20 border-t-white',
        sizes[size],
        className
      )}
    />
  );
};

/**
 * Modal component
 */
export const Modal = ({ isOpen, onClose, children, className }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={clsx(
          'relative z-10 glass-card rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};

/**
 * Toast component
 */
export const Toast = ({ message, type = 'info', onClose }) => {
  const types = {
    info: 'bg-blue-500/90',
    success: 'bg-green-500/90',
    error: 'bg-red-500/90',
    warning: 'bg-yellow-500/90'
  };

  return (
    <div
      className={clsx(
        'fixed bottom-4 right-4 z-50',
        'px-4 py-3 rounded-lg text-white shadow-lg',
        'animate-slide-in-bottom',
        types[type]
      )}
    >
      <div className="flex items-center gap-2">
        <span>{message}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 text-white/80 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
