import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceOrb, levelToScale, type OrbState } from './VoiceOrb';

/**
 * The orb shows the voice session's real state, and moves only when
 * something real is happening -- never under reduced motion.
 */

let frames: FrameRequestCallback[] = [];
let reducedMotion = false;

beforeEach(() => {
  frames = [];
  reducedMotion = false;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => vi.restoreAllMocks());

const orb = () => screen.getByRole('img');
const ring = () => orb().firstElementChild as HTMLElement;

describe('VoiceOrb', () => {
  it.each<[OrbState, string]>([
    ['off', 'Voice is off'],
    ['idle', 'Assistant ready'],
    ['listening', 'Assistant listening'],
    ['processing', 'Assistant working'],
    ['speaking', 'Assistant speaking'],
    ['error', 'Microphone problem'],
  ])('%s is named "%s" and marked as that state', (state, label) => {
    render(<VoiceOrb state={state} />);

    expect(orb()).toHaveAccessibleName(label);
    expect(orb()).toHaveAttribute('data-state', state);
  });

  it('shows the working arc only while processing, and the breath only while speaking', () => {
    const { container, rerender } = render(<VoiceOrb state="processing" />);
    expect(container.querySelector('[data-orb-part="arc"]')).not.toBeNull();
    expect(container.querySelector('[data-orb-part="breath"]')).toBeNull();

    rerender(<VoiceOrb state="speaking" />);
    expect(container.querySelector('[data-orb-part="arc"]')).toBeNull();
    expect(container.querySelector('[data-orb-part="breath"]')).not.toBeNull();

    rerender(<VoiceOrb state="idle" />);
    expect(container.querySelector('[data-orb-part]')).toBeNull();
  });

  it('every animation is switched off for reduced motion', () => {
    const { container } = render(<VoiceOrb state="processing" />);
    expect(container.querySelector('[data-orb-part="arc"]')).toHaveClass('motion-reduce:animate-none');
  });

  it('follows the measured level while listening', () => {
    const readLevel = vi.fn(() => -15);
    render(<VoiceOrb state="listening" readLevel={readLevel} />);

    expect(frames).toHaveLength(1);
    frames[0](0);

    expect(readLevel).toHaveBeenCalled();
    expect(ring().style.getPropertyValue('--orb-level')).toBe(String(levelToScale(-15)));
  });

  it('does not poll the level in any other state', () => {
    const readLevel = vi.fn(() => -15);
    for (const state of ['idle', 'processing', 'speaking', 'error', 'off'] as const) {
      const { unmount } = render(<VoiceOrb state={state} readLevel={readLevel} />);
      unmount();
    }

    expect(frames).toHaveLength(0);
    expect(readLevel).not.toHaveBeenCalled();
  });

  it('with no measurement, the ring stays still rather than pretending', () => {
    render(<VoiceOrb state="listening" />);

    expect(frames).toHaveLength(0);
    expect(ring().style.getPropertyValue('--orb-level')).toBe('1');
  });

  it('does not animate the level under reduced motion', () => {
    reducedMotion = true;
    const readLevel = vi.fn(() => -10);
    render(<VoiceOrb state="listening" readLevel={readLevel} />);

    expect(frames).toHaveLength(0);
    expect(readLevel).not.toHaveBeenCalled();
  });

  it('stops polling when listening ends or the orb unmounts', () => {
    const { rerender, unmount } = render(<VoiceOrb state="listening" readLevel={() => -20} />);
    rerender(<VoiceOrb state="processing" readLevel={() => -20} />);
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(ring().style.getPropertyValue('--orb-level')).toBe('1');

    rerender(<VoiceOrb state="listening" readLevel={() => -20} />);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it.each([
    [null, 1],
    [-100, 1],
    [-60, 1],
    [-15, 1.3],
    [0, 1.3],
    [Number.NaN, 1],
  ])('level %s dBFS scales the ring to %s', (db, scale) => {
    expect(levelToScale(db)).toBeCloseTo(scale);
  });
});
