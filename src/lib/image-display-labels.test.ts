import {
    formatImageDurationLabel,
    getActivityLogLevelLabel,
    getImageBackgroundLabel,
    getImageModerationLabel,
    getImageOutputFormatLabel,
    getImageQualityLabel
} from './image-display-labels';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const messages: Record<string, string> = {
    'common.auto': 'Automatic',
    'common.low': 'Low',
    'common.medium': 'Medium',
    'common.high': 'High',
    'common.png': 'PNG',
    'common.jpeg': 'JPEG',
    'common.webp': 'WebP',
    'form.backgroundOpaque': 'Opaque',
    'form.backgroundTransparent': 'Transparent',
    'history.durationMilliseconds': '{value} ms',
    'history.durationSeconds': '{value} s',
    'history.durationMinutesSeconds': '{minutes}m {seconds}s',
    'history.durationHoursMinutesSeconds': '{hours}h {minutes}m {seconds}s',
    'logs.levelDebug': 'Debug',
    'logs.levelInfo': 'Info',
    'logs.levelWarn': 'Warning',
    'logs.levelError': 'Error'
};

const translate = (key: string, values?: Record<string, string | number>): string =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => String(values?.[name] ?? match));

describe('image display labels', () => {
    it('localizes every supported image request enum', () => {
        assert.equal(getImageQualityLabel('auto', translate), 'Automatic');
        assert.equal(getImageQualityLabel('low', translate), 'Low');
        assert.equal(getImageQualityLabel('medium', translate), 'Medium');
        assert.equal(getImageQualityLabel('high', translate), 'High');
        assert.equal(getImageBackgroundLabel('opaque', translate), 'Opaque');
        assert.equal(getImageBackgroundLabel('transparent', translate), 'Transparent');
        assert.equal(getImageModerationLabel('auto', translate), 'Automatic');
        assert.equal(getImageModerationLabel('low', translate), 'Low');
        assert.equal(getImageOutputFormatLabel('png', translate), 'PNG');
        assert.equal(getImageOutputFormatLabel('jpeg', translate), 'JPEG');
        assert.equal(getImageOutputFormatLabel('webp', translate), 'WebP');
    });

    it('keeps unexpected persisted values visible for diagnosis', () => {
        assert.equal(getImageQualityLabel('experimental', translate), 'experimental');
        assert.equal(getImageOutputFormatLabel('avif', translate), 'avif');
    });

    it('formats image durations with localized unit labels', () => {
        assert.equal(formatImageDurationLabel(850, 'en-US', translate), '850 ms');
        assert.equal(formatImageDurationLabel(1350, 'en-US', translate), '1.4 s');
        assert.equal(formatImageDurationLabel(61_000, 'en-US', translate), '1m 01s');
        assert.equal(formatImageDurationLabel(3_661_000, 'en-US', translate), '1h 01m 01s');
    });

    it('localizes known activity log levels and preserves unknown diagnostic values', () => {
        assert.equal(getActivityLogLevelLabel('debug', translate), 'Debug');
        assert.equal(getActivityLogLevelLabel('info', translate), 'Info');
        assert.equal(getActivityLogLevelLabel('warn', translate), 'Warning');
        assert.equal(getActivityLogLevelLabel('error', translate), 'Error');
        assert.equal(getActivityLogLevelLabel('trace', translate), 'trace');
    });
});
