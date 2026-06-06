import { ImageCompareView, resolveCompareTargetIndex } from './image-compare-view';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('resolveCompareTargetIndex', () => {
    it('compares the first image against the next image', () => {
        assert.equal(resolveCompareTargetIndex(2, 0), 1);
    });

    it('compares later images against the previous image', () => {
        assert.equal(resolveCompareTargetIndex(4, 2), 1);
    });

    it('requires at least two images and a valid selected index', () => {
        assert.equal(resolveCompareTargetIndex(1, 0), null);
        assert.equal(resolveCompareTargetIndex(2, null), null);
        assert.equal(resolveCompareTargetIndex(2, 2), null);
    });
});

describe('ImageCompareView', () => {
    it('renders side-by-side comparison labels and filenames', () => {
        const html = renderToStaticMarkup(
            <ImageCompareView
                leftImage={{ path: '/api/image/first.png', filename: 'first.png' }}
                leftLabel='上一张'
                rightImage={{ path: '/api/image/second.png', filename: 'second.png' }}
                rightLabel='当前图'
            />
        );

        assert.match(html, /上一张/);
        assert.match(html, /当前图/);
        assert.match(html, /first\.png/);
        assert.match(html, /second\.png/);
        assert.match(html, /grid-cols-1/);
        assert.match(html, /sm:grid-cols-2/);
    });
});
