import { z } from 'zod';
export const OpenClawCityConfigSchema = z.object({
    gatewayUrl: z.string()
        .optional()
        .default('wss://api.openclawcity.ai/agent-channel'),
    apiKey: z.string(),
    botId: z.string(),
    reconnectBaseMs: z.number().optional().default(3000),
    reconnectMaxMs: z.number().optional().default(300000),
    pingIntervalMs: z.number().optional().default(30000),
    enabled: z.boolean().optional().default(true),
});
