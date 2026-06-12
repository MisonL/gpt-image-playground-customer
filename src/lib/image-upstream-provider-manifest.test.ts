import {
    createProviderManifestProfile,
    createProviderManifestSummary,
    parseImageProviderManifest,
    validateImageProviderManifest
} from './image-upstream-provider-manifest';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('image upstream provider manifest', () => {
    it('parses sync JSON, multipart edit, and async poll capability summaries', () => {
        const manifest = parseImageProviderManifest(
            JSON.stringify({
                schema_version: 1,
                id: 'custom_async',
                name: 'Custom Async',
                base_profile: 'matsca',
                base_url: 'https://provider.example.com/v1',
                modes: {
                    generate: {
                        submit: {
                            path: '/images/generations',
                            content_type: 'application/json',
                            response_format: 'custom-json'
                        },
                        poll: {
                            path: '/jobs/{id}',
                            status_path: 'status',
                            success_values: ['succeeded'],
                            failure_values: ['failed']
                        }
                    },
                    edit: {
                        submit: {
                            path: '/images/edits',
                            content_type: 'multipart/form-data'
                        }
                    }
                },
                constraints: {
                    generate_count: { min: 1, max: 2 },
                    edit_count: { min: 1, max: 1 },
                    partial_images: { min: 0, max: 2 },
                    upload: {
                        max_images: 4,
                        max_single_bytes: 10485760,
                        max_total_bytes: 41943040
                    },
                    gpt_image_2: {
                        allow_transparent_background: true,
                        size_policy: 'positive-integer'
                    }
                }
            })
        );

        assert.deepEqual(createProviderManifestSummary(manifest), {
            id: 'custom_async',
            name: 'Custom Async',
            baseProfile: 'matsca',
            modes: {
                generate: 'async-poll',
                edit: 'multipart'
            },
            requestTypes: {
                generate: 'application/json',
                edit: 'multipart/form-data'
            },
            responseFormats: {
                generate: 'custom-json',
                edit: 'openai-images'
            },
            asyncPolling: {
                generate: true,
                edit: false
            }
        });
        assert.deepEqual(createProviderManifestProfile(manifest), {
            id: 'matsca',
            providerManifest: createProviderManifestSummary(manifest),
            generateCount: { min: 1, max: 2 },
            editCount: { min: 1, max: 1 },
            partialImages: { min: 0, max: 2 },
            upload: {
                maxImages: 4,
                maxSingleBytes: 10485760,
                maxTotalBytes: 41943040
            },
            gptImage2: {
                allowTransparentBackground: true,
                sizePolicy: 'positive-integer'
            }
        });
    });

    it('rejects unsafe or ambiguous manifests instead of silently falling back', () => {
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'Bad',
                    modes: { generate: { submit: { path: '/images/generations' } } }
                }),
            /id 必须/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: 'https://provider.example.com/images' } } }
                }),
            /相对 API 路径/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations', method: 'PUT' } } }
                }),
            /只支持 POST/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { generate_count: { min: 3, max: 2 } }
                }),
            /min 不能大于 max/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { generate_count: { min: 1, max: 11 } }
                }),
            /generate_count\.max 不能大于 10/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { partial_images: { min: 0, max: 5 } }
                }),
            /partial_images\.max 不能大于 4/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { upload: { max_images: 11 } }
                }),
            /upload\.max_images 不能大于 10/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { upload: { max_single_bytes: 25 * 1024 * 1024 + 1 } }
                }),
            /upload\.max_single_bytes 不能大于 26214400/
        );
        assert.throws(
            () =>
                validateImageProviderManifest({
                    id: 'ok_provider',
                    modes: { generate: { submit: { path: '/images/generations' } } },
                    constraints: { upload: { max_total_bytes: 100 * 1024 * 1024 + 1 } }
                }),
            /upload\.max_total_bytes 不能大于 104857600/
        );
    });
});
