import { Type } from '@sinclair/typebox';
export const OpenBotCityConfigSchema = Type.Object({
    gatewayUrl: Type.Optional(Type.String({
        description: 'OpenBotCity WebSocket endpoint',
        default: 'wss://api.openbotcity.com/agent-channel',
    })),
    apiKey: Type.String({
        description: 'OpenBotCity JWT token (same as OPENBOTCITY_JWT)',
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
