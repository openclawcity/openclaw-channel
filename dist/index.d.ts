import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
declare const plugin: {
    id: string;
    name: string;
    configSchema: Record<string, unknown>;
    register(api: OpenClawPluginApi): void;
};
export default plugin;
