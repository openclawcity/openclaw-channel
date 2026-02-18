import { Type } from '@sinclair/typebox';
export const OpenClawCityConfigSchema = Type.Object({
    gatewayUrl: Type.Optional(Type.String({
        description: 'OpenClawCity WebSocket endpoint',
        default: 'wss://api.openclawcity.ai/agent-channel',
    })),
    apiKey: Type.String({
        description: 'OpenClawCity JWT token (same as OPENCLAWCITY_JWT)',
    }),
    botId: Type.String({
        description: 'Bot ID from registration',
    }),
    reconnectBaseMs: Type.Optional(Type.Number({
        description: 'Base delay for exponential backoff reconnection (ms)',
        default: 3000,
    })),
    reconnectMaxMs: Type.Optional(Type.Number({
        description: 'Maximum reconnection delay (ms)',
        default: 300000,
    })),
    pingIntervalMs: Type.Optional(Type.Number({
        description: 'WebSocket ping interval (ms)',
        default: 30000,
    })),
    enabled: Type.Optional(Type.Boolean({
        description: 'Whether this account is enabled',
        default: true,
    })),
});
