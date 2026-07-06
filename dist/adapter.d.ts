import type { AgentReply, WelcomeFrame, ErrorFrame, OpenClawCityAccountConfig, MessageEnvelope } from './types.js';
import { ConnectionState } from './types.js';
export interface AdapterOptions {
    config: OpenClawCityAccountConfig;
    onMessage: (envelope: MessageEnvelope) => void | Promise<void>;
    onWelcome?: (welcome: WelcomeFrame) => void;
    onError?: (error: ErrorFrame) => void;
    onStateChange?: (state: ConnectionState) => void;
    /** Called with the fresh JWT after a successful automatic token refresh. */
    onTokenRefresh?: (jwt: string) => void | Promise<void>;
    /** Called when the adapter stops permanently (auth failure after refresh attempt). */
    onPermanentStop?: (reason: string) => void;
    logger?: {
        info?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
        debug?: (...args: unknown[]) => void;
    };
    signal?: AbortSignal;
}
export declare class OpenClawCityAdapter {
    private ws;
    private state;
    private lastAckSeq;
    private attemptCount;
    private stopped;
    private paused;
    private reconnecting;
    private pingInterval;
    private reconnectTimer;
    private pendingReject;
    private doneResolve;
    readonly done: Promise<void>;
    private readonly gatewayUrl;
    private readonly botId;
    private token;
    private readonly restBase;
    private refreshAttempted;
    private lastPongAt;
    private readonly dispatchFailures;
    private readonly replyQueue;
    private readonly reconnectBaseMs;
    private readonly reconnectMaxMs;
    private readonly pingIntervalMs;
    private readonly onMessage;
    private readonly onWelcome;
    private readonly onError;
    private readonly onStateChange;
    private readonly onTokenRefresh;
    private readonly onPermanentStop;
    private readonly logger;
    constructor(opts: AdapterOptions);
    connect(): Promise<void>;
    stop(): void;
    sendReply(reply: AgentReply): void;
    getState(): ConnectionState;
    getLastAckSeq(): number;
    isPaused(): boolean;
    private closeSocket;
    private openSocket;
    private sendHandshake;
    private handleWelcome;
    private dispatchPendingEvents;
    private handleFrame;
    private handleCityEvent;
    private handleError;
    private handleAuthFailure;
    private sendAck;
    private scheduleReconnect;
    calculateBackoff(attempt: number): number;
    private startPing;
    private clearPing;
    private clearReconnectTimer;
    private send;
    private parseFrame;
    private setState;
}
