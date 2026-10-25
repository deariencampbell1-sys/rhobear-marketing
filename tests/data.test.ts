import { describe, expect, it } from 'vitest';
import { brand, brandSources } from '../src/data/brand';
import {
  productById,
  productInternals,
  productOrder,
  products,
  productsById,
} from '../src/data/products';
import type { ProductId } from '../src/data/products';

const INTENT = 'lanes/L9-front-door/INTENT.md';
const INTENT_PRODUCTS_SECTION =
  '3. What each product really is — and what the front door may say';

describe('brand', () => {
  it('sources the family line to the locked Five apps facts', () => {
    expect(brandSources.familyLine.doc).toBe('lanes/README.md');
    expect(brandSources.familyLine.section).toContain('Five apps');
  });

  it('points the engines destination at the /engines route', () => {
    expect(brand.enginesDestination).toBe('/engines');
  });
});

describe('product order', () => {
  it('lists products in brand.appOrder order with matching counts', () => {
    expect(products.map((product) => product.id)).toEqual(brand.appOrder);
    expect(products.length).toBe(productOrder.length);
  });

  it('freezes a copy of brand.appOrder instead of aliasing it', () => {
    expect(Object.isFrozen(productOrder)).toBe(true);
    expect(productOrder).not.toBe(brand.appOrder);
    expect([...productOrder]).toEqual([...brand.appOrder]);
  });
});

describe('productsById', () => {
  it('has every productOrder id and exactly those keys', () => {
    for (const id of productOrder) {
      expect(Object.prototype.hasOwnProperty.call(productsById, id), id).toBe(true);
    }
    expect(Object.keys(productsById)).toEqual([...productOrder]);
  });

  it('maps each id to the same object as the products entry', () => {
    for (const product of products) {
      expect(productsById[product.id]).toBe(product);
    }
  });

  it('throws an accurate message for an id with no entry', () => {
    expect(() => productById('not-an-app' as ProductId)).toThrowError(
      new Error('products: no entry for id "not-an-app"'),
    );
  });
});

describe('product internals', () => {
  it('keys the internals in productOrder order', () => {
    expect(Object.keys(productInternals)).toEqual([...productOrder]);
  });

  it('does not leak internal-only caveats into public product data', () => {
    const publicJson = JSON.stringify(products);
    expect(publicJson).not.toContain('Dojo Hinge V3');
    expect(publicJson).not.toContain('locked UX is being rebuilt');
  });

  it('keeps the internal caveats in productInternals', () => {
    expect(productInternals.forge.truthBoundary).toContain('Dojo Hinge V3');
    expect(productInternals.builds.truthBoundary).toContain('locked UX is being rebuilt');
  });
});

describe('product sources', () => {
  it('cites the INTENT products heading for every product', () => {
    for (const product of products) {
      expect(product.source, product.id).toEqual({
        doc: INTENT,
        section: INTENT_PRODUCTS_SECTION,
      });
    }
  });

  it('cites the INTENT release truth subsection for Builds availability', () => {
    expect(productsById.builds.extraSources).toEqual([
      {
        doc: INTENT,
        section: '4. Money, account, download and demo reality — Get / release truth',
      },
    ]);
  });
});
