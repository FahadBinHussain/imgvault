/**
 * Spinner — canonical copy extracted from the extension's
 * nextgen-extension/src/components/UI.jsx (phase-3 parity merge).
 */
export const Spinner = ({ size = 'md', className }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div
      className={[
        'animate-spin rounded-full border-2 border-base-content/20 border-t-base-content',
        sizes[size],
        className || '',
      ].join(' ')}
    />
  );
};
