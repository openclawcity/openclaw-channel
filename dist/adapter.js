import WebSocket from 'ws';
import { ConnectionState } from './types.js';
import { normalize } from './normalizer.js';
const PROTOCOL_VERSION = 1;
const DEFAULT_GATEWAY_URL = 'wss://api.openclawcity.ai/agent-channel';
const DEFAULT_RECONNECT_BASE_MS = 3000;
const DEFAULT_RECONNECT_MAX_MS = 300_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
export class OpenClawCityAdapter {
    ws = null;
    state = ConnectionState.DISCONNECTED;
    lastAckSeq = 0;
    attemptCount = 0;
    stopped = false;
    paused = false;
    reconnecting = false;
    pingInterval = null;
    reconnectTimer = null;
    // Used to reject the openSocket promise on pre-welcome errors
    pendingReject = null;
    gatewayUrl;
    botId;
    token;
    reconnectBaseMs;
    reconnectMaxMs;
    pingIntervalMs;
    onMessage;
    onWelcome;
    onError;
    onStateChange;
    logger;
    constructor(opts) {
        this.gatewayUrl = opts.config.gatewayUrl ?? DEFAULT_GATEWAY_URL;
        this.botId = opts.config.botId;
        this.token = opts.config.apiKey;
        this.reconnectBaseMs = opts.config.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
        this.reconnectMaxMs = opts.config.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
        this.pingIntervalMs = opts.config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
        this.onMessage = opts.onMessage;
        this.onWelcome = opts.onWelcome;
        this.onError = opts.onError;
        this.onStateChange = opts.onStateChange;
        this.logger = opts.logger ?? {};
        if (opts.signal) {
            opts.signal.addEventListener('abort', () => this.stop(), { once: true });
        }
    }
    // ── Public API ──
    async connect() {
        if (this.stopped)
            return;
        this.setState(ConnectionState.CONNECTING);
        try {
            await this.openSocket();
        }
        catch (err) {
            if (this.stopped)
                return;
            this.logger.error?.('Connection failed:', err);
            // Only schedule reconnect if handleError hasn't already set a timer
            // (e.g. rate_limited with retryAfter)
            if (!this.reconnectTimer) {
                this.scheduleReconnect();
            }
        }
    }
    stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        this.clearPing();
        this.clearReconnectTimer();
        // Reject any pending openSocket promise so connect() doesn't hang
        if (this.pendingReject) {
            this.pendingReject(new Error('stopped'));
            this.pendingReject = null;
        }
        this.closeSocket();
        this.setState(ConnectionState.DISCONNECTED);
    }
    sendReply(reply) {
        this.send(reply);
    }
    getState() {
        return this.state;
    }
    getLastAckSeq() {
        return this.lastAckSeq;
    }
    isPaused() {
        return this.paused;
    }
    // ── Internal: Socket Management ──
    closeSocket() {
        if (this.ws) {
            // Remove all listeners to prevent callbacks from a dead socket
            this.ws.removeAllListeners();
            try {
                this.ws.close(1000, 'shutdown');
            }
            catch {
                // ignore close errors on already-closed sockets
            }
            this.ws = null;
        }
    }
    openSocket() {
        return new Promise((resolve, reject) => {
            if (this.stopped)
                return reject(new Error('stopped'));
            // Store reject so handleError can abort if server errors before welcome
            this.pendingReject = reject;
            // Clean up any previous socket before creating a new one
            this.closeSocket();
            const ws = new WebSocket(this.gatewayUrl);
            this.ws = ws;
            ws.on('open', () => {
                if (this.stopped) {
                    ws.close();
                    return reject(new Error('stopped'));
                }
                this.sendHandshake();
            });
            ws.on('message', (data) => {
                const frame = this.parseFrame(data);
                if (!frame)
                    return;
                if (frame.type === 'welcome') {
                    this.pendingReject = null;
                    this.handleWelcome(frame);
                    resolve();
                }
                else if (frame.type === 'error') {
                    // Error before welcome — reject the connect promise
                    this.pendingReject = null;
                    this.handleError(frame);
                    reject(new Error(`Server error: ${frame.reason}`));
                }
                else {
                    this.handleFrame(frame);
                }
            });
            ws.on('close', () => {
                this.clearPing();
                if (!this.stopped) {
                    this.setState(ConnectionState.DISCONNECTED);
                    // Only schedule reconnect if handleError hasn't already set a timer
                    // (e.g. rate_limited with retryAfter)
                    if (!this.reconnectTimer) {
                        this.scheduleReconnect();
                    }
                }
            });
            ws.on('error', (err) => {
                this.logger.error?.('WebSocket error:', err.message);
                // Only reject if we're still waiting for the promise to settle.
                // The close event will handle reconnection — do NOT schedule here
                // to avoid double-reconnect.
                if (this.pendingReject) {
                    this.pendingReject = null;
                    reject(err);
                }
            });
        });
    }
    sendHandshake() {
        if (this.lastAckSeq > 0) {
            this.send({
                type: 'resume',
                version: PROTOCOL_VERSION,
                botId: this.botId,
                token: this.token,
                lastAckSeq: this.lastAckSeq,
            });
        }
        else {
            this.send({
                type: 'hello',
                version: PROTOCOL_VERSION,
                botId: this.botId,
                token: this.token,
            });
        }
    }
    handleWelcome(welcome) {
        this.setState(ConnectionState.CONNECTED);
        this.attemptCount = 0;
        this.reconnecting = false;
        this.paused = false;
        this.startPing();
        this.onWelcome?.(welcome);
        // Dispatch pending events sequentially
        if (welcome.pending?.length) {
            this.dispatchPendingEvents(welcome.pending);
        }
    }
    async dispatchPendingEvents(events) {
        for (const event of events) {
            await this.handleCityEvent(event);
        }
    }
    handleFrame(frame) {
        switch (frame.type) {
            case 'city_event':
                // Intentionally fire-and-forget: handleCityEvent has its own
                // try/catch so unhandled rejections are impossible, and we don't
                // want to block the WebSocket message handler on slow dispatches.
                void this.handleCityEvent(frame);
                break;
            case 'action_result':
                this.logger.debug?.('Action result:', frame.success, frame.data ?? frame.error);
                break;
            case 'error':
                this.handleError(frame);
                break;
            case 'paused':
                this.paused = true;
                this.logger.info?.('Bot paused:', frame.message);
                break;
            case 'resumed':
                this.paused = false;
                this.logger.info?.('Bot resumed');
                break;
            default:
                this.logger.debug?.('Unknown frame type:', frame.type);
        }
    }
    async handleCityEvent(event) {
        try {
            const envelope = normalize(event);
            await this.onMessage(envelope);
            this.sendAck(event.seq);
        }
        catch (err) {
            this.logger.error?.('Failed to dispatch event:', err);
            // Still ack so the server doesn't replay indefinitely.
            // The event was received; the dispatch error is on our side.
            this.sendAck(event.seq);
        }
    }
    handleError(frame) {
        this.logger.error?.(`Server error: ${frame.reason} — ${frame.message ?? ''}`);
        this.onError?.(frame);
        if (frame.reason === 'auth_failed' || frame.reason === 'token_expired') {
            this.stop();
        }
        else if (frame.reason === 'rate_limited' && frame.retryAfter) {
            // Respect the server's retryAfter before next reconnect
            this.clearReconnectTimer();
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this.stopped)
                    void this.connect();
            }, frame.retryAfter * 1000);
        }
    }
    sendAck(seq) {
        this.lastAckSeq = seq;
        this.send({ type: 'ack', seq });
    }
    // ── Internal: Reconnection ──
    scheduleReconnect() {
        if (this.stopped || this.reconnecting)
            return;
        this.reconnecting = true;
        const delay = this.calculateBackoff(this.attemptCount);
        this.attemptCount++;
        this.logger.info?.(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.attemptCount})`);
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnecting = false;
            if (this.stopped)
                return;
            void this.connect();
        }, delay);
    }
    calculateBackoff(attempt) {
        const exponential = this.reconnectBaseMs * Math.pow(2, attempt);
        const capped = Math.min(exponential, this.reconnectMaxMs);
        const jitter = capped * 0.3 * (Math.random() * 2 - 1);
        return Math.max(100, capped + jitter);
    }
    // ── Internal: Ping ──
    startPing() {
        this.clearPing();
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, this.pingIntervalMs);
    }
    clearPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    // ── Internal: Helpers ──
    send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    parseFrame(data) {
        try {
            return JSON.parse(data.toString());
        }
        catch {
            this.logger.warn?.('Failed to parse frame:', data.toString().slice(0, 200));
            return null;
        }
    }
    setState(next) {
        if (this.state !== next) {
            this.state = next;
            this.onStateChange?.(next);
        }
    }
}
