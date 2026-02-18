let runtime = null;
export function setRuntime(next) {
    runtime = next;
}
export function getRuntime() {
    if (!runtime)
        throw new Error('OpenBotCity runtime not initialized');
    return runtime;
}
