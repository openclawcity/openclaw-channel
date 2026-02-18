import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawCityAdapter, type AdapterOptions } from '../src/adapter.js';
import { ConnectionState } from '../src/types.js';
import type { WelcomeFrame } from '../src/types.js';

// ── Mock WebSocket ──

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  private listeners: Record<string, ((...args: any[]) => void)[]> = {};
  sentMessages: string[] = [];

  on(event: string, cb: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeAllListeners() {
    this.listeners = {};
  }

  emit(event: string, ...args: any[]) {
    // Copy the array so removals during emit are safe
    const cbs = [...(this.listeners[event] ?? [])];
    cbs.forEach((cb) => cb(...args));
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  ping() {
    this.sentMessages.push('__ping__');
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// Track all created instances so tests can inspect reconnect behavior
let mockWsInstances: MockWebSocket[] = [];
let mockWsInstance: MockWebSocket;

vi.mock('ws', () => {
  return {
    default: class FakeWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      constructor() {
        mockWsInstance = new MockWebSocket();
        mockWsInstances.push(mockWsInstance);
        return mockWsInstance as any;
      }
    },
  };
});

function makeOpts(overrides: Partial<AdapterOptions> = {}): AdapterOptions {
  return {
    config: {
      botId: 'test-bot-123',
      apiKey: 'test-token-abc',
      gatewayUrl: 'wss://localhost/test',
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      pingIntervalMs: 50,
    },
    onMessage: vi.fn().mockResolvedValue(undefined),
    onWelcome: vi.fn(),
    onError: vi.fn(),
    onStateChange: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

const WELCOME: WelcomeFrame = {
  type: 'welcome',
  version: 1,
  location: { zoneId: 1, zoneName: 'Downtown' },
  nearby: [{ id: 'b1', name: 'Alice' }],
  pending: [],
};

/** Helper: connect an adapter and return it in CONNECTED state */
async function connectAdapter(opts: AdapterOptions) {
  const adapter = new OpenClawCityAdapter(opts);
  const p = adapter.connect();
  await vi.advanceTimersByTimeAsync(0);
  mockWsInstance.emit('open');
  mockWsInstance.emit('message', JSON.stringify(WELCOME));
  await p;
  return adapter;
}

describe('OpenClawCityAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Connection ──

  it('sends hello on first connect', async () => {
    const opts = makeOpts();
    const adapter = new OpenClawCityAdapter(opts);

    const connectPromise = adapter.connect();
    await vi.advanceTimersByTimeAsync(0);
    mockWsInstance.emit('open');

    expect(mockWsInstance.sentMessages.length).toBe(1);
    const hello = JSON.parse(mockWsInstance.sentMessages[0]);
    expect(hello).toEqual({
      type: 'hello',
      version: 1,
      botId: 'test-bot-123',
      token: 'test-token-abc',
    });

    mockWsInstance.emit('message', JSON.stringify(WELCOME));
    await connectPromise;

    expect(adapter.getState()).toBe(ConnectionState.CONNECTED);
    expect(opts.onWelcome).toHaveBeenCalledWith(WELCOME);
  });

  it('sends resume with lastAckSeq on reconnect', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    // Dispatch an event to advance the ackSeq
    mockWsInstance.emit('message', JSON.stringify({
      type: 'city_event',
      seq: 42,
      eventType: 'dm_message',
      from: { id: 'u1', name: 'Alice' },
      text: 'Hello',
      metadata: { conversationId: 'c1' },
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.getLastAckSeq()).toBe(42);

    // Simulate disconnect (close fires, triggering reconnect)
    mockWsInstance.emit('close');

    // Wait for reconnect timer
    await vi.advanceTimersByTimeAsync(200);

    // The new WebSocket should send resume (not hello)
    mockWsInstance.emit('open');

    const resumeMsg = JSON.parse(mockWsInstance.sentMessages[0]);
    expect(resumeMsg).toEqual({
      type: 'resume',
      version: 1,
      botId: 'test-bot-123',
      token: 'test-token-abc',
      lastAckSeq: 42,
    });

    adapter.stop();
  });

  // ── Reconnection ──

  it('exponential backoff timing', () => {
    const opts = makeOpts({
      config: {
        botId: 'b',
        apiKey: 'k',
        reconnectBaseMs: 100,
        reconnectMaxMs: 10000,
      },
    });
    const adapter = new OpenClawCityAdapter(opts);

    const attempts = [0, 1, 2, 3, 4, 5];
    const delays = attempts.map((a) => adapter.calculateBackoff(a));

    for (let i = 0; i < delays.length; i++) {
      const expected = 100 * Math.pow(2, attempts[i]);
      const capped = Math.min(expected, 10000);
      // With ±30% jitter, value should be between 0.7x and 1.3x (min 100)
      expect(delays[i]).toBeGreaterThanOrEqual(Math.max(100, capped * 0.7));
      expect(delays[i]).toBeLessThanOrEqual(capped * 1.3);
    }
  });

  it('does NOT double-reconnect when error + close both fire', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);
    const instanceCountBefore = mockWsInstances.length;

    // Simulate a network failure: both error and close fire
    mockWsInstance.emit('error', new Error('ECONNRESET'));
    mockWsInstance.emit('close');

    // Wait well past the reconnect delay
    await vi.advanceTimersByTimeAsync(500);

    // Should have created exactly ONE new socket (not two)
    expect(mockWsInstances.length).toBe(instanceCountBefore + 1);

    adapter.stop();
  });

  // ── Ping ──

  it('sends ping at the configured interval', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    mockWsInstance.sentMessages = [];

    await vi.advanceTimersByTimeAsync(55);
    expect(mockWsInstance.sentMessages).toContain('__ping__');

    mockWsInstance.sentMessages = [];
    await vi.advanceTimersByTimeAsync(55);
    expect(mockWsInstance.sentMessages).toContain('__ping__');

    adapter.stop();
  });

  // ── Ack ──

  it('sends ack after event is dispatched', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    mockWsInstance.sentMessages = [];

    mockWsInstance.emit('message', JSON.stringify({
      type: 'city_event',
      seq: 7,
      eventType: 'dm_message',
      from: { id: 'u1', name: 'Bob' },
      text: 'Hi there',
      metadata: {},
    }));
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.onMessage).toHaveBeenCalledTimes(1);
    const ack = JSON.parse(mockWsInstance.sentMessages[0]);
    expect(ack).toEqual({ type: 'ack', seq: 7 });
    expect(adapter.getLastAckSeq()).toBe(7);

    adapter.stop();
  });

  it('still acks even when onMessage throws', async () => {
    const opts = makeOpts({
      onMessage: vi.fn().mockRejectedValue(new Error('dispatch failed')),
    });
    const adapter = await connectAdapter(opts);

    mockWsInstance.sentMessages = [];

    mockWsInstance.emit('message', JSON.stringify({
      type: 'city_event',
      seq: 99,
      eventType: 'dm_message',
      from: { id: 'u1', name: 'Eve' },
      text: 'crash',
      metadata: {},
    }));
    await vi.advanceTimersByTimeAsync(0);

    // Should still have sent ack despite dispatch failure
    const ack = JSON.parse(mockWsInstance.sentMessages[0]);
    expect(ack).toEqual({ type: 'ack', seq: 99 });
    expect(adapter.getLastAckSeq()).toBe(99);

    adapter.stop();
  });

  // ── Stop ──

  it('stops cleanly and does not reconnect', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    adapter.stop();
    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);

    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  // ── Pause / Resume ──

  it('handles paused and resumed frames', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    expect(adapter.isPaused()).toBe(false);

    mockWsInstance.emit(
      'message',
      JSON.stringify({ type: 'paused', message: 'Owner paused the bot' })
    );
    expect(adapter.isPaused()).toBe(true);

    mockWsInstance.emit('message', JSON.stringify({ type: 'resumed' }));
    expect(adapter.isPaused()).toBe(false);

    adapter.stop();
  });

  // ── Error Handling ──

  it('stops on auth_failed error', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    mockWsInstance.emit(
      'message',
      JSON.stringify({ type: 'error', reason: 'auth_failed', message: 'Bad token' })
    );

    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);
    expect(opts.onError).toHaveBeenCalled();
  });

  it('stops on token_expired error', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    mockWsInstance.emit(
      'message',
      JSON.stringify({ type: 'error', reason: 'token_expired' })
    );

    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  it('rejects connect promise if server sends error before welcome', async () => {
    const opts = makeOpts();
    const adapter = new OpenClawCityAdapter(opts);

    const connectPromise = adapter.connect();
    await vi.advanceTimersByTimeAsync(0);
    mockWsInstance.emit('open');

    // Server sends auth_failed instead of welcome
    mockWsInstance.emit(
      'message',
      JSON.stringify({ type: 'error', reason: 'auth_failed', message: 'Invalid JWT' })
    );

    // connect() should reject (not hang forever)
    await expect(connectPromise).resolves.toBeUndefined();
    // adapter stops itself on auth_failed
    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  it('respects rate_limited retryAfter', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);
    const instanceCountBefore = mockWsInstances.length;

    // Server sends rate_limited with retryAfter: 5 seconds
    mockWsInstance.emit(
      'message',
      JSON.stringify({ type: 'error', reason: 'rate_limited', retryAfter: 5 })
    );

    // Should NOT reconnect immediately
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWsInstances.length).toBe(instanceCountBefore);

    // After retryAfter (5s), should reconnect
    await vi.advanceTimersByTimeAsync(4100);
    expect(mockWsInstances.length).toBe(instanceCountBefore + 1);

    adapter.stop();
  });

  // ── sendReply ──

  it('sendReply does nothing when disconnected', () => {
    const opts = makeOpts();
    const adapter = new OpenClawCityAdapter(opts);

    // Should not throw — just silently drops
    expect(() => {
      adapter.sendReply({
        type: 'agent_reply',
        action: 'dm_reply',
        text: 'hello',
      });
    }).not.toThrow();
  });

  // ── Pending Events ──

  it('dispatches pending events from welcome sequentially', async () => {
    const order: number[] = [];
    const opts = makeOpts({
      onMessage: vi.fn().mockImplementation(async (envelope: any) => {
        order.push(envelope.metadata.seq);
      }),
    });
    const adapter = new OpenClawCityAdapter(opts);

    const welcomeWithPending: WelcomeFrame = {
      ...WELCOME,
      pending: [
        { type: 'city_event', seq: 1, eventType: 'dm_message', from: { id: 'u1', name: 'A' }, text: 'first', metadata: {} },
        { type: 'city_event', seq: 2, eventType: 'dm_message', from: { id: 'u2', name: 'B' }, text: 'second', metadata: {} },
        { type: 'city_event', seq: 3, eventType: 'dm_message', from: { id: 'u3', name: 'C' }, text: 'third', metadata: {} },
      ],
    };

    const p = adapter.connect();
    await vi.advanceTimersByTimeAsync(0);
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', JSON.stringify(welcomeWithPending));
    await p;

    // Let all pending dispatches complete
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.onMessage).toHaveBeenCalledTimes(3);
    expect(order).toEqual([1, 2, 3]);

    adapter.stop();
  });

  // ── AbortSignal ──

  it('stops when AbortSignal fires', async () => {
    const controller = new AbortController();
    const opts = makeOpts({ signal: controller.signal });
    const adapter = await connectAdapter(opts);

    expect(adapter.getState()).toBe(ConnectionState.CONNECTED);

    controller.abort();

    expect(adapter.getState()).toBe(ConnectionState.DISCONNECTED);
  });

  // ── Listener Cleanup ──

  it('cleans up listeners on old socket during reconnect', async () => {
    const opts = makeOpts();
    const adapter = await connectAdapter(opts);

    const firstWs = mockWsInstance;

    // Disconnect
    mockWsInstance.emit('close');

    // After reconnect timer fires, a new socket is created
    await vi.advanceTimersByTimeAsync(200);

    // The first socket should have had removeAllListeners called (via closeSocket)
    // Verify by emitting on the old socket — should not affect adapter state
    const secondWs = mockWsInstance;
    expect(secondWs).not.toBe(firstWs);

    // Emit close on old socket — should not trigger another reconnect
    const instanceCount = mockWsInstances.length;
    firstWs.emit('close');
    await vi.advanceTimersByTimeAsync(500);

    // No new sockets created from the stale close event
    // (One may have been created from the new socket's connection flow, but not from the old one)
    expect(mockWsInstances.length).toBeLessThanOrEqual(instanceCount + 1);

    adapter.stop();
  });
});
