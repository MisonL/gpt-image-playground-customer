import {
    buildDefaultUpstreamHeaders,
    mergeUpstreamHeadersWithFixed,
    normalizeConfiguredUpstreamHeaders,
    summarizeUpstreamRequestHeaders
} from './upstream-request-headers';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('upstream request headers', () => {
    it('uses a stable product User-Agent by default', () => {
        assert.deepEqual(buildDefaultUpstreamHeaders({}), {
            'User-Agent': 'gpt-image-playground/2.1.0'
        });
    });

    it('allows an explicit environment User-Agent override', () => {
        assert.deepEqual(buildDefaultUpstreamHeaders({ OPENAI_UPSTREAM_USER_AGENT: ' custom-agent/1.0 ' }), {
            'User-Agent': 'custom-agent/1.0'
        });
    });

    it('keeps fixed protocol headers ahead of configured extras', () => {
        assert.deepEqual(
            mergeUpstreamHeadersWithFixed(
                {
                    'User-Agent': 'custom-agent/1.0',
                    Authorization: 'Bearer wrong',
                    Accept: 'text/plain',
                    'X-App-ID': 'app'
                },
                {
                    Authorization: 'Bearer right',
                    Accept: 'application/json'
                },
                {}
            ),
            {
                'User-Agent': 'custom-agent/1.0',
                'X-App-ID': 'app',
                Authorization: 'Bearer right',
                Accept: 'application/json'
            }
        );
    });

    it('rejects unsafe configurable protocol headers', () => {
        assert.throws(
            () =>
                normalizeConfiguredUpstreamHeaders(
                    { Authorization: 'Bearer secret' },
                    'OPENAI_CHANNEL_1_UPSTREAM_HEADERS_JSON'
                ),
            /不能配置 Authorization/
        );
        assert.throws(
            () =>
                normalizeConfiguredUpstreamHeaders(
                    { 'Content-Type': 'text/plain' },
                    'OPENAI_CHANNEL_1_UPSTREAM_HEADERS_JSON'
                ),
            /不能配置 Content-Type/
        );
    });

    it('summarizes request headers without exposing secret values', () => {
        assert.deepEqual(
            summarizeUpstreamRequestHeaders(
                {
                    'User-Agent': 'custom-agent/1.0',
                    'X-App-ID': 'app-id',
                    'X-App-Secret': 'secret'
                },
                {}
            ),
            {
                user_agent_effective: 'custom-agent/1.0',
                has_extra_headers: true,
                allowed_header_names: ['user-agent', 'x-app-id', 'x-app-secret'],
                configured_header_names: ['user-agent', 'x-app-id', 'x-app-secret']
            }
        );
    });
});
