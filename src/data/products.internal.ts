// INTERNAL ONLY — never import this module from a client component or render it.
import type { ProductId } from './products';

export interface ProductInternals {
  truthBoundary: string;
}

// Internal-only caveats kept out of the public product objects, keyed by id.
export const productInternals: Readonly<Record<ProductId, ProductInternals>> = {
  builds: {
    truthBoundary:
      'Cloud and native substance are real, the locked UX is being rebuilt, and TestFlight 1.0 (build 32) is owner-confirmed as the only accepted mobile release; other release targets are not proved available.',
  },
  forge: {
    truthBoundary:
      'The engine, desktop and scripts are substantial, but direct printing, camera control, farm and six-platform release are not all production-proven, and Dojo Hinge V3, the first commercial kit, awaits physical-fit acceptance.',
  },
  herald: {
    truthBoundary:
      'Availability and entitlements come from its own lane; there is no self-serve checkout on this site.',
  },
  regent: {
    truthBoundary:
      'There is no self-serve quote, no agency data is published, and no live call handling is claimed in public.',
  },
  reviews: {
    truthBoundary:
      'Apollo and Zeus work today as reviewer and builder agents; standalone paid Reviews plans are not published.',
  },
};
