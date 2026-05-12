export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { recoverAgentStateOnStartup } = await import('./lib/agent-state-runtime');
    await recoverAgentStateOnStartup();
}
