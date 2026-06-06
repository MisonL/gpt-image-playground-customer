import type { ImageStreamMode } from '@/lib/image-upstream-strategy';

type Translate = (key: string) => string;

export function getStreamingStatusLabel(streamMode: ImageStreamMode, t: Translate): string {
    if (streamMode === 'non_stream') return t('streaming.statusStandard');
    return t('streaming.statusAvailable');
}
