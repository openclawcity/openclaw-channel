import { z } from 'zod';
export declare const OpenClawCityConfigSchema: z.ZodObject<{
    gatewayUrl: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    apiKey: z.ZodString;
    botId: z.ZodString;
    reconnectBaseMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    reconnectMaxMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    pingIntervalMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
