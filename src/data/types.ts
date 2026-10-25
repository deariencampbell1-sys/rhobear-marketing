// W0-01: content model types for the front door. W0-02 fills the data;
// nothing here invents product claims, prices or availability.

export interface Product {
  id: 'builds' | 'forge' | 'herald' | 'regent' | 'reviews';
  name: string;
  path: string;
  summary: string;
}

export interface Engine {
  id: string;
  name: string;
  summary: string;
}

export interface Price {
  /** Integer minor units (e.g. 1999 = $19.99); never a floating-point amount. */
  amountMinor: number;
  currency: string;
  /** 'month' | 'year' | 'once' — set only when billing is real. */
  period: string;
}

export interface Plan {
  id: string;
  name: string;
  summary: string;
  /** Empty array until real prices exist: never render a placeholder number. */
  prices: Price[];
  channel: 'web' | 'app-store' | 'play';
}

export interface Availability {
  /** e.g. 'macOS', 'Windows' — set only when a build really ships there. */
  platform: string;
  status: 'available' | 'coming';
  version?: string;
}

export interface Demo {
  /** Real demo only: a poster/URL that exists. Empty until it does. */
  title: string;
  url: string;
  poster?: string;
}

export interface SupportInfo {
  channels: { label: string; href: string }[];
  hours: string;
}

export interface LegalDoc {
  path: string;
  title: string;
  updated: string;
  sections: { heading: string; body: string }[];
}

export interface SiteContent {
  products: Product[];
  engines: Engine[];
  plans: Plan[];
  availability: Availability[];
  demo: Demo | null;
  support: SupportInfo;
  privacy: LegalDoc;
  terms: LegalDoc;
}