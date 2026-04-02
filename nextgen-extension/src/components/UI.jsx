/**
 * @fileoverview Reusable UI Components
 * @version 2.0.0
 */

import React from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';

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
        'animate-spin rounded-full border-2 border-base-content/20 border-t-base-content',
        sizes[size],
        className
      )}
    />
  );
};

/**
 * Modal component
 */
export const Modal = ({ isOpen, onClose, title, children, className, fullscreen = false }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-base-content/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={clsx(
          'relative z-10 rounded-[var(--radius-box)] p-6 w-full overflow-y-auto border border-base-content/20 bg-base-100 shadow-2xl',
          fullscreen
            ? 'max-w-7xl max-h-[95vh] h-full'
            : 'max-w-lg max-h-[90vh]',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between mb-6">
            {typeof title === 'string' ? (
              <h2 className="text-2xl font-bold text-base-content">{title}</h2>
            ) : (
              title
            )}
            {!fullscreen && (
              <button
                onClick={onClose}
                className="p-2 rounded-[var(--radius-box)] hover:bg-base-content/10 transition-colors text-base-content/70 hover:text-base-content"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
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
        'fixed bottom-4 right-4 z-50',
        'px-6 py-4 rounded-[var(--radius-box)]',
        'animate-slide-in-bottom',
        'border border-base-content/10',
        config.bg,
        config.glow,
        'backdrop-blur-xl',
        'transform transition-all duration-300',
        'hover:scale-105'
      )}
    >
      <div className="flex items-center gap-3">
        <span className="font-medium text-lg">{message}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 opacity-80 hover:opacity-100 transition-all hover:rotate-90 transform duration-200"
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

