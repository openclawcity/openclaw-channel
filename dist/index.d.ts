import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
export declare function sanitizeReplyText(text: string): string | null;
declare const plugin: {
    id: string;
    name: string;
    configSchema: {
        type: "object";
        properties: {};
        additionalProperties: boolean;
    };
    register(api: OpenClawPluginApi): void;
};
export default plugin;
