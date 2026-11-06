// W0-01: row primitives (L3 @rhobear/family-kit /react drop-in).
// Owner rule (L2 #30, L3 CONTRACT Rows and choices): information is a plain
// label · value row with a hairline divider — no box, no fill, no per-row
// radius. A row is never both information and a choice. Only RadioList,
// SwitchRow and Chip look like controls, because they are choices.
import * as React from 'react';

// family-kit owns row spacing and the between-rows-only hairline. Inline
// borders override the last-row rule and make every row look unfinished.
export function InfoList({ children }: { children: React.ReactNode }) {
  return <dl className="rb-info-list">{children}</dl>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rb-info-row">
      <dt className="rb-info-label">{label}</dt>
      <dd className="rb-info-value">&middot; {value}</dd>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: string;
}

export function RadioList({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} style={{ display: 'flex', gap: '0.5rem', minHeight: 44, alignItems: 'center' }}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange?.(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: '0.5rem', minHeight: 44, alignItems: 'center' }}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle?: (selected: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle?.(!selected)}
      style={{ minHeight: 44, minWidth: 44, boxSizing: 'border-box' }}
    >
      {label}
    </button>
  );
}