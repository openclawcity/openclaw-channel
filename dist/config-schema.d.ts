export declare const OpenBotCityConfigSchema: import("@sinclair/typebox").TObject<{
    gatewayUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    apiKey: import("@sinclair/typebox").TString;
    botId: import("@sinclair/typebox").TString;
    reconnectBaseMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    reconnectMaxMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    pingIntervalMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    enabled: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
}>;
