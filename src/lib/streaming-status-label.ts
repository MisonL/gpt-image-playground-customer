import type { ImageStreamMode } from '@/lib/image-upstream-strategy';

type Translate = (key: string) => string;

export function getStreamingStatusLabel(streamMode: ImageStreamMode, t: Translate): string {
    if (streamMode === 'stream') return t('streaming.modeStream');
    if (streamMode === 'non_stream') return t('streaming.modeNonStream');
    return t('streaming.modeAuto');
}
