import { Window } from 'happy-dom';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const clientDomGlobalNames = [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'Element',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'Node',
    'NodeFilter',
    'DocumentFragment',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'FocusEvent',
    'PointerEvent',
    'CustomEvent',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT'
] as const;

type ClientDomGlobalName = (typeof clientDomGlobalNames)[number];

type ClientDomRenderer = {
    container: HTMLDivElement;
    render: (node: ReactNode) => Promise<void>;
    click: (element: HTMLElement) => Promise<void>;
    cleanup: () => Promise<void>;
};

function setClientDomGlobals(window: Window): Map<ClientDomGlobalName, PropertyDescriptor | undefined> {
    const descriptors = new Map<ClientDomGlobalName, PropertyDescriptor | undefined>();
    const values: Record<ClientDomGlobalName, unknown> = {
        window,
        document: window.document,
        navigator: window.navigator,
        location: window.location,
        history: window.history,
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Node: window.Node,
        NodeFilter: window.NodeFilter,
        DocumentFragment: window.DocumentFragment,
        Event: window.Event,
        MouseEvent: window.MouseEvent,
        KeyboardEvent: window.KeyboardEvent,
        FocusEvent: window.FocusEvent,
        PointerEvent: window.PointerEvent,
        CustomEvent: window.CustomEvent,
        MutationObserver: window.MutationObserver,
        ResizeObserver: window.ResizeObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        IS_REACT_ACT_ENVIRONMENT: true
    };

    for (const name of clientDomGlobalNames) {
        descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value: values[name]
        });
    }

    return descriptors;
}

function restoreClientDomGlobals(descriptors: Map<ClientDomGlobalName, PropertyDescriptor | undefined>) {
    for (const name of clientDomGlobalNames) {
        const descriptor = descriptors.get(name);
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, name);
        }
    }
}

function installClientDomLayoutStyles(window: Window): void {
    const style = window.document.createElement('style');
    style.textContent =
        '.relative { position: relative; } img[data-nimg="fill"] { width: 1px !important; height: 1px !important; }';
    window.document.head.append(style);
}

function dispatchClientDomEvent(element: HTMLElement, event: unknown) {
    element.dispatchEvent(event as Event);
}

export async function renderInClientDom(node: ReactNode): Promise<ClientDomRenderer> {
    const window = new Window({ url: 'http://localhost' });
    const descriptors = setClientDomGlobals(window);
    installClientDomLayoutStyles(window);
    const happyDomContainer = window.document.createElement('div');
    window.document.body.append(happyDomContainer);
    const container = happyDomContainer as unknown as HTMLDivElement;
    const root: Root = createRoot(container);
    let cleanedUp = false;

    const render = async (nextNode: ReactNode) => {
        await act(async () => {
            root.render(nextNode);
        });
    };

    const cleanup = async () => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        try {
            await act(async () => {
                root.unmount();
            });
        } finally {
            container.remove();
            try {
                await window.happyDOM.close();
            } finally {
                restoreClientDomGlobals(descriptors);
            }
        }
    };

    try {
        await render(node);
    } catch (error) {
        await cleanup();
        throw error;
    }

    return {
        container,
        render,
        click: async (element) => {
            await act(async () => {
                dispatchClientDomEvent(
                    element,
                    new window.PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 })
                );
                dispatchClientDomEvent(
                    element,
                    new window.MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 })
                );
                dispatchClientDomEvent(element, new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
                dispatchClientDomEvent(element, new window.PointerEvent('pointerup', { bubbles: true, button: 0 }));
                element.click();
            });
        },
        cleanup
    };
}
