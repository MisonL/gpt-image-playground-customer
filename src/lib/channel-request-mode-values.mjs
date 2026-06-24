export const CHANNEL_REQUEST_MODES = Object.freeze([
    'images-non-stream',
    'images-sse',
    'responses-non-stream',
    'responses-sse'
]);

export const CHANNEL_REQUEST_MODE_SMOKE_CASES = Object.freeze({
    'images-non-stream': Object.freeze(['generate_1k', 'edit_1k']),
    'images-sse': Object.freeze(['page_sse_edit_2k']),
    'responses-non-stream': Object.freeze(['responses_agent_generate_1k']),
    'responses-sse': Object.freeze(['responses_page_sse_generate_1k'])
});

export const CHANNEL_REQUEST_MODE_ADMIN_CONTROL = Object.freeze({
    source: 'admin_env_whitelist',
    globalEnv: 'OPENAI_UPSTREAM_REQUEST_MODES',
    channelEnvPattern: 'OPENAI_CHANNEL_N_REQUEST_MODES',
    mutableAtRuntime: false,
    finalGateCommand:
        'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable',
    smokeGateCommands: Object.freeze({
        'images-non-stream': Object.freeze([
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case original-images-json --allow-billable'
        ]),
        'images-sse': Object.freeze([
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case sub2api-images-sse --allow-billable'
        ]),
        'responses-non-stream': Object.freeze([
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case sub2api-responses-json --allow-billable'
        ]),
        'responses-sse': Object.freeze([
            'npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --case gpt2image-responses-sse --allow-billable'
        ])
    })
});
