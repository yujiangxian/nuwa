import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Smoke test verifying the Vitest + React Testing Library + jsdom environment
 * is wired up correctly: jsdom renders DOM, RTL queries work, and the
 * jest-dom matchers (loaded via src/test/setup.ts) are available.
 */
describe('test environment', () => {
  it('renders a React element into jsdom and exposes jest-dom matchers', () => {
    render(<div data-testid="probe">hello</div>);
    const el = screen.getByTestId('probe');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('hello');
  });
});
