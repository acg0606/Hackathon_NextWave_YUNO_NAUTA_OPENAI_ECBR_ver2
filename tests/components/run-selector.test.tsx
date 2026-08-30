// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunSelector } from '@/components/runtime/RunSelector';

afterEach(cleanup);

describe('RunSelector order composer', () => {
  it('preserves intermediate coordinate text and validates it on commit', () => {
    const onCreate = vi.fn();
    render(
      <RunSelector
        activeRunId={null}
        onCreate={onCreate}
        onSelect={vi.fn()}
        runs={[]}
      />,
    );

    const latitude = screen.getByLabelText('Latitude') as HTMLInputElement;
    fireEvent.change(latitude, { target: { value: '-' } });
    expect(latitude.value).toBe('-');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.blur(latitude);
    expect(screen.getByRole('alert').textContent).toMatch(/latitude from/i);
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(latitude, { target: { value: '37.0662' } });
    fireEvent.click(screen.getByRole('button', { name: /buy delivery/i }));
    expect(onCreate).toHaveBeenCalledWith(
      'booking-preparation',
      expect.objectContaining({
        destination: 'Gaziantep',
        destinationCoordinates: [37.3781, 37.0662],
        product: 'Industrial furniture components',
        transportMode: 'OCEAN_ROAD',
      }),
    );
  });
});
