type Translate = (key: string, values?: Record<string, string | number>) => string;

export function getImageQualityLabel(value: string, t: Translate): string {
    if (value === 'auto') return t('common.auto');
    if (value === 'low') return t('common.low');
    if (value === 'medium') return t('common.medium');
    if (value === 'high') return t('common.high');
    return value;
}

export function getImageBackgroundLabel(value: string, t: Translate): string {
    if (value === 'auto') return t('common.auto');
    if (value === 'opaque') return t('form.backgroundOpaque');
    if (value === 'transparent') return t('form.backgroundTransparent');
    return value;
}

export function getImageModerationLabel(value: string, t: Translate): string {
    if (value === 'auto') return t('common.auto');
    if (value === 'low') return t('common.low');
    return value;
}

export function getImageOutputFormatLabel(value: string, t: Translate): string {
    if (value === 'png') return t('common.png');
    if (value === 'jpeg') return t('common.jpeg');
    if (value === 'webp') return t('common.webp');
    return value;
}

export function formatImageDurationLabel(value: number, locale: string, t: Translate): string {
    const integerFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
    const paddedIntegerFormatter = new Intl.NumberFormat(locale, {
        minimumIntegerDigits: 2,
        useGrouping: false
    });

    if (value < 1000) {
        return t('history.durationMilliseconds', { value: integerFormatter.format(value) });
    }

    const totalSeconds = Math.round(value / 1000);
    if (totalSeconds < 60) {
        const seconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1000);
        return t('history.durationSeconds', { value: seconds });
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const formattedMinutes = paddedIntegerFormatter.format(minutes);
    const formattedSeconds = paddedIntegerFormatter.format(seconds);

    if (hours > 0) {
        return t('history.durationHoursMinutesSeconds', {
            hours: integerFormatter.format(hours),
            minutes: formattedMinutes,
            seconds: formattedSeconds
        });
    }

    return t('history.durationMinutesSeconds', {
        minutes: integerFormatter.format(minutes),
        seconds: formattedSeconds
    });
}

export function getActivityLogLevelLabel(value: string, t: Translate): string {
    if (value === 'debug') return t('logs.levelDebug');
    if (value === 'info') return t('logs.levelInfo');
    if (value === 'warn') return t('logs.levelWarn');
    if (value === 'error') return t('logs.levelError');
    return value;
}
