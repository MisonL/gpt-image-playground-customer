export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const [{ recoverAgentStateOnStartup }, { appLogger }, { readBooleanEnv }] = await Promise.all([
        import('./lib/agent-state-runtime'),
        import('./lib/app-logger'),
        import('./lib/server-runtime')
    ]);
    try {
        appLogger.info('开始执行 Agent 状态启动恢复。');
        const recovered = await recoverAgentStateOnStartup();
        appLogger.info('Agent 状态启动恢复完成。', { recovered });
    } catch (error) {
        appLogger.error('Agent 状态启动恢复失败。', error);
        const critical = process.env.AGENT_STATE_RECOVERY_CRITICAL === undefined || readBooleanEnv(process.env, 'AGENT_STATE_RECOVERY_CRITICAL');
        if (critical) {
            throw error;
        }
        appLogger.warn('Agent 状态启动恢复失败，已按配置继续以降级状态运行。');
    }
}
