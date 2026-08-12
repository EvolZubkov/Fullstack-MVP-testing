import type { CSSProperties } from 'react';

/** Utility: merge className strings, drop falsy. */
export function cn(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ');
}

const unitlessCssProperties = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexNegative',
  'flexOrder',
  'flexPositive',
  'flexShrink',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  'fillOpacity',
  'floodOpacity',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
]);

const dynamicStyleCache = new Map<string, string>();
let dynamicStyleSheet: CSSStyleSheet | null = null;

function getDynamicStyleSheet(): CSSStyleSheet | null {
  if (typeof document === 'undefined') return null;
  if (dynamicStyleSheet) return dynamicStyleSheet;

  const tag = document.createElement('style');
  tag.setAttribute('data-ou-dynamic-styles', '');
  document.head.appendChild(tag);
  dynamicStyleSheet = tag.sheet as CSSStyleSheet | null;
  return dynamicStyleSheet;
}

function hashCssText(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function toCssProperty(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`).replace(/^ms-/, '-ms-');
}

function toCssValue(name: string, value: string | number): string {
  if (typeof value === 'number' && value !== 0 && !name.startsWith('--') && !unitlessCssProperties.has(name)) {
    return `${value}px`;
  }
  return String(value);
}

function styleToCssText(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, value]) => value != null && value !== '')
    .map(([name, value]) => `${toCssProperty(name)}:${toCssValue(name, value as string | number)}`)
    .sort()
    .join(';');
}

export function cssStyleClass(
  style: CSSProperties | false | null | undefined,
  prefix = 'ou-sx',
): string | undefined {
  if (!style) return undefined;

  const cssText = styleToCssText(style);
  if (!cssText) return undefined;

  const cached = dynamicStyleCache.get(cssText);
  if (cached) return cached;

  const className = `${prefix}-${hashCssText(cssText)}`;
  const sheet = getDynamicStyleSheet();
  if (!sheet) {
    return className;
  }

  if (sheet) {
    try {
      sheet.insertRule(`.${className}{${cssText}}`, sheet.cssRules.length);
      dynamicStyleCache.set(cssText, className);
    } catch {
      return undefined;
    }
  }

  return className;
}

export type Size = 's' | 'm' | 'l';
export type SizeXS = 'xs' | Size;

export type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
