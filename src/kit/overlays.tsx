// W0-01: overlays (L3 @rhobear/family-kit /react drop-in).
// Sheet: labelled dialog shell — aria-modal, focus trapped while open, focus
// restored to the invoking control on close, Escape closes. Progress: renders
// nothing without a determinate numeric value. LiveRegion: polite, one region
// per change.
import * as React from 'react';

export function Sheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const invoker = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (!open) return;
    invoker.current = document.activeElement;
    const node = ref.current;
    const focusables = node?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusables?.[0] ?? node)?.focus();
    return () => {
      (invoker.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const node = ref.current;
    const focusables = Array.from(
      node?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function Progress({ value, max = 100, label }: { value?: number; max?: number; label?: string }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return (
    <progress aria-label={label} value={value} max={max}>
      {value}/{max}
    </progress>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}