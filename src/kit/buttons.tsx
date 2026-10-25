// W0-01: Button — kit-named primitive (L3 @rhobear/family-kit /react drop-in).
// Hit region >= 44x44 logical px even when the visible art is smaller; visible
// 2 px accent focus outline; disabled uses real semantics; native Space/Enter
// and pointer activation (no extra key handlers, so exactly one activation).
import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps {
  variant?: ButtonVariant;
  /** 'a' renders an anchor and requires href. Default renders <button type="button">. */
  as?: 'button' | 'a';
  href?: string;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  children: React.ReactNode;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

export function Button({
  variant = 'primary',
  as = 'button',
  href,
  disabled = false,
  onClick,
  children,
  style,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const [focused, setFocused] = React.useState(false);
  const hit: React.CSSProperties = {
    minHeight: 44,
    minWidth: 44,
    boxSizing: 'border-box',
    ...(focused ? { outline: '2px solid AccentColor', outlineOffset: 2 } : {}),
    ...style,
  };
  const focusHandlers = {
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };

  if (as === 'a') {
    return (
      <a
        href={href}
        data-variant={variant}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onClick={(e) => {
          if (disabled) e.preventDefault();
          else onClick?.(e);
        }}
        style={hit}
        {...focusHandlers}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      data-variant={variant}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      style={hit}
      {...focusHandlers}
    >
      {children}
    </button>
  );
}