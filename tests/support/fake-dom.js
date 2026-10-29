// A small fake DOM for running page scripts in node:vm: just what the pages and their tests use.
const assert = require('node:assert/strict');

class FakeElement {
    constructor(document, tagName) {
        Object.assign(this, { ownerDocument: document, tagName: tagName.toUpperCase(), childNodes: [], parentNode: null, attributes: new Map(),
            dataset: {}, listeners: {}, hidden: false, disabled: false, className: '', ownText: '' });
        this.style = { setProperty: (name, value) => { this.style[name] = String(value); } };
        this.classList = { add: () => {}, remove: () => {} };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get tabIndex() { return Number(this.getAttribute('tabindex') ?? (this.tagName === 'BUTTON' ? 0 : -1)); }
    set tabIndex(value) { this.setAttribute('tabindex', value); }
    get options() { return this.childNodes.filter(node => node.tagName === 'OPTION'); }
    // A select's value is its chosen option's; choosing a value no option has leaves it empty, as in a browser.
    get value() { return this.tagName === 'SELECT' ? this.selected ?? this.options[0]?.value ?? '' : this.ownValue ?? ''; }
    set value(value) {
        if (this.tagName === 'SELECT') this.selected = this.options.some(option => option.value === value) ? value : '';
        else this.ownValue = value;
    }
    get textContent() { return this.ownText + this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this.ownText = String(value ?? ''); }
    append(...nodes) {
        for (let node of nodes) {
            // Strings become text nodes, as in a browser.
            if (typeof node === 'string') { const text = new FakeElement(this.ownerDocument, '#text'); text.ownText = node; node = text; }
            node.parentNode?.removeChild(node); node.parentNode = this; this.childNodes.push(node);
        }
    }
    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = []; this.ownText = ''; this.selected = undefined; this.append(...nodes);
    }
    removeChild(node) { this.childNodes = this.childNodes.filter(child => child !== node); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] ?? null;
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
    // Enough selector support for the page and tests: tag, [attr], [attr="value"] and .class.
    matches(selector) {
        const tag = /^[a-z][a-z0-9]*/.exec(selector)?.[0];
        return (!tag || this.tagName === tag.toUpperCase()) && [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]|\.([\w-]+)/g)].every(([, name, value, className]) =>
            className ? this.className.split(/\s+/).includes(className) : value === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === value);
    }
    closest(selector) { for (let node = this; node instanceof FakeElement; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
        const found = [];
        const walk = node => node.childNodes.forEach(child => { if (child.matches(selector)) found.push(child); walk(child); });
        walk(this);
        return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, extra = {}) {
        const event = { type, target: this, cancelable: true, defaultPrevented: false, preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, ...extra };
        for (let node = this; node; node = node.parentNode) (node.listeners[type] || []).forEach(listener => listener(event));
        return event;
    }
    focus() { this.ownerDocument.activeElement = this; this.dispatch('focusin'); }
    click() { if (this.disabled) return; this.focus(); this.onclick?.({ type: 'click', target: this }); }
    // Dialogs: showModal refuses an open dialog, as browsers do; close fires "close".
    showModal() { if (this.open) throw new Error('InvalidStateError: the dialog is already open'); this.open = true; }
    close() { if (!this.open) return; this.open = false; this.dispatch('close'); }
    // Escape on an open dialog, as Chrome does it: "cancel" can only be refused after a fresh user action, so a
    // repeated Escape (activated: false) closes the dialog whatever the page does.
    escape({ activated = true } = {}) {
        const event = this.dispatch('cancel', { cancelable: activated });
        if (!event.defaultPrevented) this.close();
    }
    get children() { return this.childNodes; }
    scrollIntoView() {}
}

/** A document whose getElementById makes any missing element on first use, plus an Option class bound to it. */
function fakeDocument() {
    const elements = new Map();
    const document = {
        readyState: 'complete', listeners: {},
        createElement: tag => new FakeElement(document, tag),
        createElementNS: (namespace, tag) => new FakeElement(document, tag),
        getElementById: id => { if (!elements.has(id)) { const node = new FakeElement(document, 'div'); node.id = id; document.body.append(node); elements.set(id, node); } return elements.get(id); },
        addEventListener() {},
    };
    document.body = new FakeElement(document, 'body');
    document.head = new FakeElement(document, 'head');
    document.activeElement = document.body;
    class Option extends FakeElement {
        constructor(text = '', value = '') { super(document, 'option'); this.textContent = text; this.value = value; }
    }
    return { document, Option };
}

// Lets pending requests, renders and the page's own zero-delay timers (the form's focus) run.
const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};
// Compare by identity and name the element on failure (printing a fake DOM node would walk the whole page).
const describe = node => node ? `${node.tagName} ${node.getAttribute('aria-label') || node.id || node.textContent.slice(0, 40)}` : String(node);
const assertFocus = (page, expected, message) => assert.ok(page.document.activeElement === expected, `${message || 'focus'}: on ${describe(page.document.activeElement)}, expected ${describe(expected)}`);

module.exports = { FakeElement, fakeDocument, settle, assertFocus };
