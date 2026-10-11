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
    primary: 'btn btn-primary',
    secondary: 'btn btn-secondary',
    danger: 'btn btn-error',
    glass: 'glass-button text-base-content',
    outline: 'btn btn-outline'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  const isDaisyButton = variant === 'primary' || variant === 'secondary' || variant === 'danger';

  return (
    <button
      className={clsx(
        'font-medium transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        variants[variant],
        isDaisyButton || variant === 'outline' ? 'min-h-0 h-auto' : sizes[size],
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
        <label className="block text-sm font-medium text-base-content/80 mb-2">
          {label}
        </label>
      )}
      <input
        className={clsx(
          'input w-full',
          'bg-base-100/70 border border-base-content/20',
          'text-base-content placeholder-base-content/50',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent',
          'transition-all duration-200',
          error && 'border-error text-error',
          className
        )}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-error">{error}</p>
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
        <label className="block text-sm font-medium text-base-content/80 mb-2">
          {label}
        </label>
      )}
      <textarea
        className={clsx(
          'textarea w-full',
          'bg-base-100/70 border border-base-content/20',
          'text-base-content placeholder-base-content/50',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent',
          'transition-all duration-200 resize-none',
          error && 'border-error text-error',
          className
        )}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-error">{error}</p>
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
        'glass-card rounded-[var(--radius-box)] p-6',
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
        'btn btn-ghost btn-square',
        'glass-button',
        'transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
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
    default: 'bg-base-300 text-base-content',
    primary: 'bg-primary/15 text-primary',
    success: 'bg-success/15 text-success',
    error: 'bg-error/15 text-error'
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
 * Modal + Spinner — re-exported from the shared ui package (parity phase 3b).
 * Canonical implementation: packages/ui (pnpm package `imgvault-ui`), shared
 * with the web app. Do not re-define them here (drift-guarded twins rule).
 */
export { Modal, Spinner } from 'imgvault-ui';

/**
 * Toast component
 */
export const Toast = ({ message, type = 'info', onClose }) => {
  const types = {
    info: {
      bg: 'bg-info',
      glow: 'shadow-2xl shadow-base-content/10'
    },
    success: {
      bg: 'bg-success',
      glow: 'shadow-2xl shadow-base-content/10'
    },
    error: {
      bg: 'bg-error',
      glow: 'shadow-2xl shadow-base-content/10'
    },
    warning: {
      bg: 'bg-warning',
      glow: 'shadow-2xl shadow-base-content/10'
    }
  };

  const config = types[type] || types.info;

  return (
    <div
      className={clsx(
        'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-50',
        'w-auto sm:max-w-[min(42rem,calc(100vw-2rem))]',
        'px-4 sm:px-6 py-4 rounded-[var(--radius-box)]',
        'animate-slide-in-bottom',
        'border border-base-content/10',
        config.bg,
        config.glow,
        'backdrop-blur-xl',
        'transform transition-all duration-300',
        'hover:scale-[1.01]'
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="font-medium text-sm sm:text-base leading-snug break-words whitespace-pre-wrap min-w-0 flex-1">
          {message}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-1 sm:ml-2 shrink-0 opacity-80 hover:opacity-100 transition-all hover:rotate-90 transform duration-200"
          >
            x
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Close Button component
 */
export const CloseButton = ({ onClick, className, ...props }) => {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-11 h-11 rounded-full bg-error/10 hover:bg-error/20',
        'border border-error/30 hover:border-error/50',
        'flex items-center justify-center',
        'transition-all duration-300 hover:scale-110 hover:rotate-90',
        'group shadow-xl',
        className
      )}
      title="Close"
      {...props}
    >
      <span className="text-error group-hover:opacity-80 text-2xl font-bold">x</span>
    </button>
  );
};

