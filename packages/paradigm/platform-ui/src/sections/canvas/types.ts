/**
 * Paradigm Canvas — TypeScript types
 *
 * Defines the schema for *.canvas YAML files, API responses,
 * CSS property types, and component prop interfaces.
 */

// ---------------------------------------------------------------------------
// Canvas file schema (persisted as YAML)
// ---------------------------------------------------------------------------

export interface CanvasFile {
  version: number;
  name: string;
  description: string;
  created: string;
  updated: string;
  editor: Record<string, CraftNode>;
  symbols: Record<string, string>;
  viewport: ViewportState;
}

export interface CraftNode {
  type: { resolvedName: string };
  isCanvas?: boolean;
  props: Record<string, unknown>;
  displayName?: string;
  custom?: Record<string, unknown>;
  parent?: string;
  nodes?: string[];
  linkedNodes?: Record<string, string>;
}

export interface ViewportState {
  width: number;
  zoom: number;
  scrollX: number;
  scrollY: number;
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface CanvasFileInfo {
  path: string;
  name: string;
  description: string;
  modified: string;
  size: number;
}

// ---------------------------------------------------------------------------
// CSS property value types
// ---------------------------------------------------------------------------

export type CSSDisplayValue = 'flex' | 'grid' | 'block' | 'none';
export type CSSFlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type CSSJustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
export type CSSAlignItems = 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
export type CSSFlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type CSSTextAlign = 'left' | 'center' | 'right' | 'justify';
export type CSSObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type CSSOverflow = 'visible' | 'hidden' | 'scroll' | 'auto';
export type CSSBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

// ---------------------------------------------------------------------------
// Component prop interfaces
// ---------------------------------------------------------------------------

export interface ContainerProps {
  display: CSSDisplayValue;
  flexDirection: CSSFlexDirection;
  justifyContent: CSSJustifyContent;
  alignItems: CSSAlignItems;
  flexWrap: CSSFlexWrap;
  gap: number;
  padding: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  margin: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  background: string;
  borderWidth: number;
  borderStyle: CSSBorderStyle;
  borderColor: string;
  borderRadius: number;
  width: string;
  height: string;
  minHeight: string;
  overflow: CSSOverflow;
  opacity: number;
  boxShadow: string;
}

export interface TextProps {
  content: string;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  color: string;
  textAlign: CSSTextAlign;
  lineHeight: number;
  letterSpacing: number;
  padding: number;
  margin: number;
}

export interface ButtonProps {
  label: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  textAlign: CSSTextAlign;
  background: string;
  padding: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  borderWidth: number;
  borderStyle: CSSBorderStyle;
  borderColor: string;
  borderRadius: number;
  width: string;
  cursor: string;
}

export interface ImageProps {
  src: string;
  alt: string;
  objectFit: CSSObjectFit;
  width: string;
  height: string;
  borderRadius: number;
}

export interface SpacerProps {
  width: string;
  height: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const CONTAINER_DEFAULTS: ContainerProps = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  flexWrap: 'nowrap',
  gap: 0,
  padding: 16,
  paddingTop: 16,
  paddingRight: 16,
  paddingBottom: 16,
  paddingLeft: 16,
  margin: 0,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  background: 'transparent',
  borderWidth: 0,
  borderStyle: 'none',
  borderColor: 'var(--p-border)',
  borderRadius: 0,
  width: '100%',
  height: 'auto',
  minHeight: '40px',
  overflow: 'visible',
  opacity: 1,
  boxShadow: 'none',
};

export const TEXT_DEFAULTS: TextProps = {
  content: 'Edit this text',
  fontSize: 16,
  fontWeight: '400',
  fontFamily: 'inherit',
  color: 'var(--p-text-primary)',
  textAlign: 'left',
  lineHeight: 1.5,
  letterSpacing: 0,
  padding: 0,
  margin: 0,
};

export const BUTTON_DEFAULTS: ButtonProps = {
  label: 'Button',
  fontSize: 14,
  fontWeight: '500',
  color: 'var(--p-bg-primary)',
  textAlign: 'center',
  background: 'var(--p-accent-blue)',
  padding: 0,
  paddingTop: 10,
  paddingRight: 20,
  paddingBottom: 10,
  paddingLeft: 20,
  borderWidth: 0,
  borderStyle: 'none',
  borderColor: 'transparent',
  borderRadius: 6,
  width: 'auto',
  cursor: 'pointer',
};

export const IMAGE_DEFAULTS: ImageProps = {
  src: '',
  alt: 'Image',
  objectFit: 'cover',
  width: '100%',
  height: '200px',
  borderRadius: 0,
};

export const SPACER_DEFAULTS: SpacerProps = {
  width: '100%',
  height: '24px',
};
