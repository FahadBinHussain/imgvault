/**
 * Modal overlay — canonical copy extracted from the extension's
 * nextgen-extension/src/components/UI.jsx (phase-3 parity merge, plan-platform-parity.md).
 * The extension keeps its own Modal in UI.jsx for other components until the
 * extension-side swap commit re-exports it from here.
 */
import { X } from 'lucide-react';

export const Modal = ({ isOpen, onClose, title, children, className, fullscreen = false }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-base-content/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={[
          'relative z-10 rounded-[var(--radius-box)] p-6 w-full overflow-y-auto border border-base-content/20 bg-base-100 shadow-2xl',
          fullscreen ? 'max-w-7xl max-h-[95vh] h-full' : 'max-w-lg max-h-[90vh]',
          className || '',
        ].join(' ')}
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
