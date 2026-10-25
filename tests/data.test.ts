import { describe, expect, it } from 'vitest';
import { brand, brandSources } from '../src/data/brand';
import {
  productById,
  productOrder,
  products,
  productsById,
} from '../src/data/products';
import type { ProductId } from '../src/data/products';
import { productInternals } from '../src/data/products.internal';

const INTENT = 'lanes/L9-front-door/INTENT.md';
const INTENT_PRODUCTS_SECTION =
  '3. What each product really is — and what the front door may say';

describe('brand', () => {
  it('sources the family line to the locked Five apps facts', () => {
    expect(brandSources.familyLine.doc).toBe('lanes/README.md');
    expect(brandSources.familyLine.section).toContain('Five apps');
  });

  it('cites the exact locked-facts section for every brand line', () => {
    expect(brandSources.tagline).toEqual({
      doc: 'lanes/README.md',
      section: 'Locked facts every lane needs — The tagline',
    });
    expect(brandSources.taglineExplanation).toEqual({
      doc: 'lanes/README.md',
      section: 'Locked facts every lane needs — The tagline',
    });
    expect(brandSources.familyLine).toEqual({
      doc: 'lanes/README.md',
      section: 'Locked facts every lane needs — Five apps',
    });
  });

  it('keeps the three locked brand strings verbatim', () => {
    expect(brand.tagline).toBe('Built by our own models.');
    expect(brand.taglineExplanation).toBe(
      'Every RHOBEAR app is built only by the four models customers get — Core, Peak, Summit and Guest — through our own pipeline. We planned it with help from Claude and Kimi K3, and our workers made it real.',
    );
    expect(brand.familyLine).toBe(
      'Five apps on one account: Builds, Forge, Herald, Regent and Reviews, plus the Engines that run inside them.',
    );
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

  it('freezes the public products array', () => {
    expect(Object.isFrozen(products)).toBe(true);
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

  it('freezes the public productsById object', () => {
    expect(Object.isFrozen(productsById)).toBe(true);
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
    expect(publicJson).not.toContain('truthBoundary');
    for (const internal of Object.values(productInternals)) {
      expect(publicJson).not.toContain(internal.truthBoundary);
    }
  });

  it('gives every public product exactly the public keys', () => {
    const publicKeys = [
      'availability',
      'id',
      'links',
      'oneLiner',
      'promise',
      'publicName',
      'source',
      'whatItIs',
    ];
    for (const product of products) {
      const expected = product.extraSources
        ? [...publicKeys, 'extraSources'].sort()
        : [...publicKeys];
      expect(Object.keys(product).sort(), product.id).toEqual(expected);
    }
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
