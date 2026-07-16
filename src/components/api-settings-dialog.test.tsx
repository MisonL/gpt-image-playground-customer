import type { ApiSettings } from './api-settings-dialog';
import { I18nProvider } from '@/lib/i18n';
import { renderInClientDom } from '@/test-utils/react-dom';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const emptySettings: ApiSettings = { apiKey: '', baseUrl: '' };
const savedSettings: ApiSettings = {
    apiKey: 'saved-key',
    baseUrl: 'https://example.test/v1'
};
const replacementSettings: ApiSettings = {
    apiKey: 'replacement-key',
    baseUrl: 'https://replacement.example/v1'
};

type ApiSettingsDialogComponent = typeof import('./api-settings-dialog').ApiSettingsDialog;

let ApiSettingsDialog: ApiSettingsDialogComponent;
let sharedView: Awaited<ReturnType<typeof renderInClientDom>>;
let ownerDocument: Document;

async function waitForActiveElement(target: HTMLElement, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (target.ownerDocument.activeElement !== target) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return false;
        await new Promise((resolve) => setTimeout(resolve, Math.min(10, remainingMs)));
    }
    return true;
}

before(async () => {
    sharedView = await renderInClientDom(<div />);
    ownerDocument = sharedView.container.ownerDocument;
    ({ ApiSettingsDialog } = await import('./api-settings-dialog'));
});

after(async () => {
    await sharedView?.cleanup();
});

function renderDialog(
    isOpen: boolean,
    settings: ApiSettings,
    options: {
        onOpenChange?: (open: boolean) => void;
        onSave?: (nextSettings: ApiSettings) => void;
        getReturnFocusTarget?: () => HTMLButtonElement | null;
    } = {}
) {
    return (
        <I18nProvider>
            <ApiSettingsDialog
                isOpen={isOpen}
                onOpenChange={options.onOpenChange ?? (() => {})}
                settings={settings}
                onSave={options.onSave ?? (() => {})}
                getReturnFocusTarget={options.getReturnFocusTarget ?? (() => null)}
            />
        </I18nProvider>
    );
}

describe('ApiSettingsDialog draft state', { concurrency: false }, () => {
    it('syncs restored settings, saves the current draft, and clears settings with stable dialog lifecycle', async () => {
        const savedValues: ApiSettings[] = [];
        const openChanges: boolean[] = [];

        await sharedView.render(renderDialog(false, emptySettings));
        await sharedView.render(renderDialog(false, savedSettings));
        await sharedView.render(renderDialog(true, savedSettings));

        let apiKeyInput = ownerDocument.querySelector<HTMLInputElement>('#api-key-input');
        let baseUrlInput = ownerDocument.querySelector<HTMLInputElement>('#api-base-url-input');
        assert.ok(apiKeyInput, 'missing API key input');
        assert.ok(baseUrlInput, 'missing API URL input');
        assert.equal(apiKeyInput.value, savedSettings.apiKey);
        assert.equal(baseUrlInput.value, savedSettings.baseUrl);

        await sharedView.render(renderDialog(true, replacementSettings));
        apiKeyInput = ownerDocument.querySelector<HTMLInputElement>('#api-key-input');
        assert.ok(apiKeyInput, 'missing API key input after external settings update');
        assert.equal(apiKeyInput.value, savedSettings.apiKey);

        await sharedView.render(renderDialog(false, replacementSettings));
        await sharedView.render(renderDialog(true, replacementSettings));

        apiKeyInput = ownerDocument.querySelector<HTMLInputElement>('#api-key-input');
        baseUrlInput = ownerDocument.querySelector<HTMLInputElement>('#api-base-url-input');
        assert.ok(apiKeyInput, 'missing reopened API key input');
        assert.ok(baseUrlInput, 'missing reopened API URL input');
        assert.equal(apiKeyInput.value, replacementSettings.apiKey);
        assert.equal(baseUrlInput.value, replacementSettings.baseUrl);

        await sharedView.render(renderDialog(false, savedSettings));
        await sharedView.render(
            renderDialog(true, savedSettings, {
                onOpenChange: (open) => openChanges.push(open),
                onSave: (settings) => savedValues.push(settings)
            })
        );
        const currentApiKeyInput = ownerDocument.querySelector<HTMLInputElement>('#api-key-input');
        const saveButton = [...ownerDocument.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === '保存'
        );
        assert.ok(currentApiKeyInput, 'missing API key input');
        assert.ok(saveButton, 'missing save button');

        await sharedView.click(saveButton);
        assert.deepEqual(savedValues, [savedSettings]);

        await sharedView.render(
            renderDialog(false, savedSettings, {
                onOpenChange: (open) => openChanges.push(open),
                onSave: (settings) => savedValues.push(settings)
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.deepEqual(openChanges, []);

        const focusTarget = ownerDocument.createElement('button');
        ownerDocument.body.append(focusTarget);

        await sharedView.render(
            renderDialog(true, savedSettings, {
                onSave: (settings) => savedValues.push(settings),
                getReturnFocusTarget: () => focusTarget
            })
        );
        const clearButton = [...ownerDocument.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === '清空'
        );
        assert.ok(clearButton, 'missing clear button');
        await sharedView.click(clearButton);
        assert.deepEqual(savedValues, [savedSettings, emptySettings]);

        await sharedView.render(
            renderDialog(false, savedSettings, {
                onSave: (settings) => savedValues.push(settings),
                getReturnFocusTarget: () => focusTarget
            })
        );
        const focusWasRestored = await waitForActiveElement(focusTarget);
        focusTarget.remove();
        assert.equal(focusWasRestored, true, 'dialog focus was not restored');
    });
});
