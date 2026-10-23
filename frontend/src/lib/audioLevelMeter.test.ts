import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAudioLevelMeter, rmsDb, SILENCE_DB } from './audioLevelMeter';

/**
 * The Web Audio level meter, against a fake AudioContext.
 *
 * jsdom has no Web Audio. The fake records the graph that is built, so
 * these prove what is connected, what is measured and what is torn down --
 * not how a real microphone sounds.
 */

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAnalyser extends FakeNode {
  fftSize = 0;
  samples: Float32Array = new Float32Array(0);
  getFloatTimeDomainData = vi.fn((target: Float32Array) => {
    target.set(this.samples.subarray(0, target.length));
  });
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = 'running';
  /** False models a browser that refuses to resume (no user gesture). */
  static resumeWorks = true;

  state: AudioContextState = FakeAudioContext.initialState;
  destination = { kind: 'destination' };
  source = new FakeNode();
  analyser = new FakeAnalyser();
  resume = vi.fn(async () => {
    if (FakeAudioContext.resumeWorks) this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamSource = vi.fn(() => this.source);
  createAnalyser = vi.fn(() => this.analyser);

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const stream = {} as MediaStream;

function setAudioContext(value: unknown) {
  Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value });
}

describe('rmsDb', () => {
  it('is the silence floor for zeros and for an empty window', () => {
    expect(rmsDb(new Float32Array(64))).toBe(SILENCE_DB);
    expect(rmsDb(new Float32Array(0))).toBe(SILENCE_DB);
  });

  it('reports a constant 0.1 signal as -20 dBFS', () => {
    expect(rmsDb(new Float32Array(64).fill(0.1))).toBeCloseTo(-20, 5);
  });

  it('reports a full-scale sine as about -3 dBFS', () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
    expect(rmsDb(sine)).toBeCloseTo(-3.01, 1);
  });
});

describe('createWebAudioLevelMeter', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = 'running';
    FakeAudioContext.resumeWorks = true;
    setAudioContext(FakeAudioContext);
  });

  afterEach(() => {
    setAudioContext(undefined);
    vi.restoreAllMocks();
  });

  it('returns null where Web Audio does not exist', () => {
    setAudioContext(undefined);
    expect(createWebAudioLevelMeter()).toBeNull();
  });

  it('analyses the stream without ever routing it to the speakers', () => {
    const meter = createWebAudioLevelMeter()!;
    const context = FakeAudioContext.instances[0];

    expect(meter.attach(stream)).toBe(true);
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(context.source.connect).toHaveBeenCalledWith(context.analyser);
    expect(context.analyser.connect).not.toHaveBeenCalled();
    expect(context.source.connect).not.toHaveBeenCalledWith(context.destination);
  });

  it('reads the current window as a dBFS level', () => {
    const meter = createWebAudioLevelMeter()!;
    const context = FakeAudioContext.instances[0];
    meter.attach(stream);

    context.analyser.samples = new Float32Array(4096).fill(0.1);

    expect(meter.read()).toBeCloseTo(-20, 5);
  });

  it('reports "cannot measure" (null), not silence, before attaching or while suspended', () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.resumeWorks = false; // the browser keeps it suspended
    const meter = createWebAudioLevelMeter()!;

    expect(meter.read()).toBeNull();
    meter.attach(stream);
    expect(meter.read()).toBeNull();
  });

  it('resumes a context that starts suspended, inside the gesture', () => {
    FakeAudioContext.initialState = 'suspended';
    createWebAudioLevelMeter();

    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledTimes(1);
  });

  it('disconnects every node and closes the context, once', () => {
    const meter = createWebAudioLevelMeter()!;
    const context = FakeAudioContext.instances[0];
    meter.attach(stream);

    meter.close();
    meter.close();

    expect(context.source.disconnect).toHaveBeenCalledTimes(1);
    expect(context.analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(meter.read()).toBeNull();
    expect(meter.attach(stream)).toBe(false);
  });

  it('reports a stream that cannot be analysed instead of throwing', () => {
    const meter = createWebAudioLevelMeter()!;
    FakeAudioContext.instances[0].createMediaStreamSource.mockImplementation(() => {
      throw new Error('not an audio stream');
    });

    expect(meter.attach(stream)).toBe(false);
    expect(meter.read()).toBeNull();
  });
});
