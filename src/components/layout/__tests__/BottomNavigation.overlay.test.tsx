/**
 * The bottom nav gets out of the way whenever something is laid over the view.
 *
 * It lives at z-150, above every modal in the app (Relocate Stock's overlay is
 * z-50), so raising z-indexes one by one was never going to hold. Instead the
 * nav listens to the body scroll lock every overlay already takes, and hides
 * while any is held. These tests pin that down for the general case, not just
 * for the one modal that surfaced it.
 */

import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ModalOverlay } from '../../ui/ModalOverlay';
import { BottomNavigation } from '../BottomNavigation';
import { ViewModeProvider } from '../../../context/ViewModeContext';

vi.mock('../../../features/picking/hooks/useDoubleCheckList', () => ({
  useDoubleCheckList: () => ({
    readyCount: 0,
    correctionCount: 0,
    waitingCount: 0,
    refresh: vi.fn(),
  }),
}));

const navPill = () => screen.getByLabelText('STOCK').closest('div.ios-glass') as HTMLElement;

const renderNav = (ui?: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ViewModeProvider>
        <BottomNavigation />
        {ui}
      </ViewModeProvider>
    </MemoryRouter>
  );

describe('BottomNavigation — hides under overlays', () => {
  it('is visible with nothing on top', () => {
    renderNav();
    expect(navPill().className).toContain('opacity-100');
    expect(navPill().className).not.toContain('opacity-0');
  });

  it('slides away while a modal is open, and comes back when it closes', () => {
    const { rerender } = renderNav();
    expect(navPill().className).toContain('opacity-100');

    const withModal = (
      <MemoryRouter>
        <ViewModeProvider>
          <BottomNavigation />
          <ModalOverlay onClose={vi.fn()}>
            <p>Relocate Stock</p>
          </ModalOverlay>
        </ViewModeProvider>
      </MemoryRouter>
    );

    act(() => {
      rerender(withModal);
    });
    expect(navPill().className).toContain('opacity-0');
    expect(navPill().className).toContain('pointer-events-none');

    act(() => {
      rerender(
        <MemoryRouter>
          <ViewModeProvider>
            <BottomNavigation />
          </ViewModeProvider>
        </MemoryRouter>
      );
    });
    expect(navPill().className).toContain('opacity-100');
  });

  it('stays hidden while an inner modal outlives the outer one', () => {
    const Stack = ({ outer, inner }: { outer: boolean; inner: boolean }) => (
      <MemoryRouter>
        <ViewModeProvider>
          <BottomNavigation />
          {outer && (
            <ModalOverlay onClose={vi.fn()}>
              <p>outer</p>
            </ModalOverlay>
          )}
          {inner && (
            <ModalOverlay onClose={vi.fn()}>
              <p>inner</p>
            </ModalOverlay>
          )}
        </ViewModeProvider>
      </MemoryRouter>
    );

    const { rerender } = render(<Stack outer inner />);
    expect(navPill().className).toContain('opacity-0');

    // The outer one closes; the nav must not reappear under the inner one.
    act(() => {
      rerender(<Stack outer={false} inner />);
    });
    expect(navPill().className).toContain('opacity-0');

    act(() => {
      rerender(<Stack outer={false} inner={false} />);
    });
    expect(navPill().className).toContain('opacity-100');
  });
});
