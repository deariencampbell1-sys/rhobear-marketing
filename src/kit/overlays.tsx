// W0-01: overlays (L3 @rhobear/family-kit /react drop-in).
// Sheet: labelled dialog shell — aria-modal, focus trapped while open, focus
// restored to the invoking control on close, Escape closes. Progress: renders
// nothing without a determinate numeric value. LiveRegion: polite, one region
// per change.
import * as React from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface FocusableLike {
  focus(): void;
}
export interface SheetDialogLike {
  querySelectorAll(selector: string): ArrayLike<FocusableLike>;
  focus(): void;
}
export interface SheetDocumentLike {
  activeElement: FocusableLike | null;
}
export interface SheetKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

// Focus behaviour lives in plain functions so it is testable without a DOM.
export function openSheetEffect(
  dialog: SheetDialogLike | null,
  doc: SheetDocumentLike,
): () => void {
  const invoker = doc.activeElement;
  const focusables = dialog?.querySelectorAll(FOCUSABLE) ?? [];
  (focusables[0] ?? dialog)?.focus();
  return () => {
    invoker?.focus();
  };
}

export function handleSheetKeyDown(
  ev: SheetKeyEvent,
  dialog: SheetDialogLike | null,
  current: FocusableLike | null,
  onClose: () => void,
): void {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    onClose();
    return;
  }
  if (ev.key !== 'Tab') return;
  const focusables = Array.from(dialog?.querySelectorAll(FOCUSABLE) ?? []);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (ev.shiftKey && current === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && current === last) {
    ev.preventDefault();
    first.focus();
  }
}

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

  React.useEffect(() => {
    if (!open) return;
    return openSheetEffect(
      ref.current as unknown as SheetDialogLike | null,
      document as unknown as SheetDocumentLike,
    );
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    handleSheetKeyDown(
      e,
      ref.current as unknown as SheetDialogLike | null,
      document.activeElement as unknown as FocusableLike | null,
      onClose,
    );
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