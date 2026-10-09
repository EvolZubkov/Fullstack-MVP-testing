import { forwardRef } from 'react';
import { cn } from '../utils';
import { Input, type InputProps } from './Input';

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export interface SearchFieldProps extends Omit<InputProps, 'iconLeft' | 'type'> {
  /** What is being searched, so the placeholder says it: «Поиск по командам». */
  scope?: string;
}

/**
 * The search of a list. One shape everywhere: the magnifier on the left, the
 * clear button once something is typed, and a placeholder that names what is
 * searched rather than repeating the word «поиск» alone.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ scope, placeholder, size = 's', clearable = true, className, ...rest }, ref) => (
    <Input
      ref={ref}
      type="search"
      size={size}
      clearable={clearable}
      iconLeft={SearchIcon}
      placeholder={placeholder ?? (scope ? `Поиск по ${scope}` : 'Поиск')}
      className={cn('ou-searchfield', className)}
      {...rest}
    />
  ),
);

SearchField.displayName = 'SearchField';
