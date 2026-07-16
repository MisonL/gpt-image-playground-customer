type StartupRecoveryDeps = {
    recoverAgentStateOnStartup: () => Promise<number>;
    appLogger: {
        info(message: string, context?: unknown): void;
        error(message: string, context?: unknown): void;
    };
};

type ServerStartupDeps = StartupRecoveryDeps & {
    startWebuiImageCleanupScheduler: () => Promise<unknown>;
};

export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const [{ recoverAgentStateOnStartup }, { appLogger }, { startWebuiImageCleanupScheduler }] = await Promise.all([
        import('./lib/agent-state-runtime'),
        import('./lib/app-logger'),
        import('./lib/webui-image-cleanup-runtime')
    ]);
    await runServerStartup({
        recoverAgentStateOnStartup,
        startWebuiImageCleanupScheduler,
        appLogger
    });
}

export async function runServerStartup(deps: ServerStartupDeps): Promise<void> {
    await runAgentStateStartupRecovery(deps);
    try {
        deps.appLogger.info('开始启动 WebUI 图片自动清理。');
        await deps.startWebuiImageCleanupScheduler();
        deps.appLogger.info('WebUI 图片自动清理启动完成。');
    } catch (error) {
        deps.appLogger.error('WebUI 图片自动清理启动失败。', error);
        throw error;
    }
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
