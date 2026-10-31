import type { CSSProperties } from 'react';
import { products } from '../data/products';
import { Button } from '../kit';

const list: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  listStyle: 'none',
  margin: 0,
  padding: '16px',
};
const link: CSSProperties = { display: 'inline-flex', alignItems: 'center' };

export function Footer(): JSX.Element {
  return (
    <footer data-shared-footer="true">
      <nav aria-label="Footer">
        <ul style={list}>
          {products.map((product) => (
            <li key={product.id}>
              <Button as="a" href={`/${product.id}`} variant="quiet" style={link}>{product.publicName} page</Button>
            </li>
          ))}
          <li><Button as="a" href="/plans" variant="quiet" style={link}>Plans and prices page</Button></li>
          <li><Button as="a" href="/get" variant="quiet" style={link}>Get the apps page</Button></li>
          <li><Button as="a" href="/support" variant="quiet" style={link}>Support page</Button></li>
          <li><Button as="a" href="/privacy" variant="quiet" style={link}>Privacy page</Button></li>
          <li><Button as="a" href="/terms" variant="quiet" style={link}>Terms page</Button></li>
        </ul>
      </nav>
    </footer>
  );
}
