let runtime = null;
export function setRuntime(next) {
    runtime = next;
}
export function getRuntime() {
    if (!runtime)
        throw new Error('OpenClawCity runtime not initialized');
    return runtime;
}
