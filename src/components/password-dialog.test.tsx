import { I18nProvider } from '@/lib/i18n';
import { renderInClientDom } from '@/test-utils/react-dom';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

type PasswordDialogComponent = typeof import('./password-dialog').PasswordDialog;

let PasswordDialog: PasswordDialogComponent;
let sharedView: Awaited<ReturnType<typeof renderInClientDom>>;
let ownerDocument: Document;

before(async () => {
    sharedView = await renderInClientDom(<div />);
    ownerDocument = sharedView.container.ownerDocument;
    ({ PasswordDialog } = await import('./password-dialog'));
});

after(async () => {
    await sharedView?.cleanup();
});

describe('PasswordDialog', { concurrency: false }, () => {
    it('associates the access-code input and save action with a native form', async () => {
        await sharedView.render(
            <I18nProvider>
                <PasswordDialog
                    isOpen
                    onOpenChange={() => {}}
                    onSave={() => {}}
                    description='Configure the access code for this test.'
                />
            </I18nProvider>
        );

        const input = ownerDocument.querySelector<HTMLInputElement>('#password-input');
        const form = ownerDocument.querySelector<HTMLFormElement>('form');
        const saveButton = [...ownerDocument.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent === '保存'
        );

        assert.ok(input, 'missing access code input');
        assert.ok(form, 'missing access code form');
        assert.ok(saveButton, 'missing save button');
        assert.equal(input.form, form);
        assert.equal(saveButton.type, 'submit');
    });
});
