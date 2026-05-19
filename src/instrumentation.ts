type StartupRecoveryDeps = {
    recoverAgentStateOnStartup: () => Promise<number>;
    appLogger: {
        info(message: string, context?: unknown): void;
        error(message: string, context?: unknown): void;
    };
};

export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const [{ recoverAgentStateOnStartup }, { appLogger }] = await Promise.all([
        import('./lib/agent-state-runtime'),
        import('./lib/app-logger')
    ]);
    await runAgentStateStartupRecovery({ recoverAgentStateOnStartup, appLogger });
}

export async function runAgentStateStartupRecovery(deps: StartupRecoveryDeps): Promise<void> {
    try {
        deps.appLogger.info('开始执行 Agent 状态启动恢复。');
        const recovered = await deps.recoverAgentStateOnStartup();
        deps.appLogger.info('Agent 状态启动恢复完成。', { recovered });
    } catch (error) {
        deps.appLogger.error('Agent 状态启动恢复失败。', error);
        throw error;
    }
}
