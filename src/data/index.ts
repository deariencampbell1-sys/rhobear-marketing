// W0-01: data entry. loadContent() returns null today: W0-02 fills the real
// content, and until then every page falls back to the honest placeholder
// copy. Never return partially invented content.
import type { SiteContent } from './types';

export type { SiteContent } from './types';

export function loadContent(): SiteContent | null {
  return null;
}