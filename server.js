const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { JSDOM, ResourceLoader, CookieJar } = require('jsdom');
const { Cookie } = require('tough-cookie');
const isDocker = require('is-docker');
const { toBeVisible } = require('jest-dom/dist/to-be-visible');

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

class CustomResourceLoader extends ResourceLoader {
    fetch(url, element) {
        if (url.includes('adobe')) return null;
        if (url.includes('cdn-cms')) return null;

        console.log('CustomResourceLoader', url);

        return super.fetch(url, element);
    }
}

const cookieJar = new CookieJar();
const resourceLoader = new CustomResourceLoader({ strictSSL: false });

https.globalAgent.options.rejectUnauthorized = false;

const readSeleniumScript = command =>
    fs.readFileSync(path.resolve(__dirname, `./selenium-scripts/${command}.js`), 'utf-8');
const writeSeleniumScript = (command, script) =>
    fs.writeFileSync(path.resolve(__dirname, `./selenium-scripts/${command}.js`), script);

const SELENIUM_SCRIPTS = {
    isDisplayed: readSeleniumScript('isDisplayed'),
};

const REQUEST = (method, app) => (path, { cmd, validate, handle }) => {
    path = path.replace(/\{(.*?)\}/g, (_, $1) => ':' + $1.replace(/\s/g, '_'));

    app[method](path, async (req, res) => {
        console.log(`${req.method.padStart(6)} ${req.url}`);
        const log = (label, json) => console.log(`      ${label.toUpperCase()}: ${JSON.stringify(json)}`);
        log(`PARAMS`, req.params);
        log(
            `BODY`,
            req.body.script && req.body.script.length > 250
                ? { ...req.body, script: req.body.script.substr(0, 250) + '...' }
                : req.body,
        );

        const error = await validate(req.params, req.body);

        // if (error === null) return res.status(404);

        if (error !== undefined) {
            const {
                status = 500,
                type = 'unsupported operation',
                message = `This operation (${cmd}) is not supported yet`,
            } = error;

            return res.status(status).json({
                value: { error: type, message },
            });
        }

        try {
            const result = await handle(req.params, req.body);
            log('RESULT', result);

            return res.json({ value: result });
        } catch (err) {
            const {
                status = 500,
                type = 'unknown error',
                message = 'An unknown error occurred handling the command',
            } = err;

            return res.status(status).json({
                value: { error: type, message: `${message}\n${err.stack}` },
            });
        }
    });
};

const app = express().use(express.json());

const GET = REQUEST('get', app);
const POST = REQUEST('post', app);
const DELETE = REQUEST('delete', app);

const ctx = {
    sessions: new Map(),
    lastSessionId: 0,
};

GET('/status', {
    description: 'Status',
    docs: 'https://github.com/jlipps/simple-wd-spec#status',
    validate(params, body) {},
    handle(params, body) {
        return { ready: true, message: 'server ready' };
    },
});

POST('/session', {
    cmd: 'New Session',
    docs: 'https://github.com/jlipps/simple-wd-spec#new-session',
    validate(params, body) {},
    handle(params, body) {
        const ID_TO_ELEMENTS = Symbol('Elements Map By Id');
        const ELEMENTS_TO_ID = Symbol('ElementIds Map By Element');

        const cookieJar = new CookieJar();
        const jsdom = new JSDOM(``, { cookieJar });

        const id = (++ctx.lastSessionId).toString();
        const session = {
            id,
            jsdom,
            cookieJar,
            getElement(id) {
                const map = this.jsdom.window[ID_TO_ELEMENTS];

                if (map) {
                    return map.get(id);
                }
            },
            getOrCreateElementId(element) {
                const { window } = this.jsdom;
                window[ID_TO_ELEMENTS] = window[ID_TO_ELEMENTS] || new Map();
                window[ELEMENTS_TO_ID] = window[ELEMENTS_TO_ID] || new WeakMap();
                window.__GET_ELEMENT__ =
                    window.__GET_ELEMENT__ ||
                    (id => {
                        const map = this.jsdom.window[ID_TO_ELEMENTS];

                        if (map) {
                            return map.get(id);
                        }
                    });

                const elementsById = window[ID_TO_ELEMENTS];
                const idsByElement = window[ELEMENTS_TO_ID];

                let id = idsByElement.get(element);
                if (id === undefined) {
                    id = (elementsById.size + 1).toString();
                    elementsById.set(id, element);
                    idsByElement.set(element, id);
                }

                return id;
            },
        };

        ctx.sessions.set(id, session);

        return { sessionId: id, capabilities: { browserName: 'JSDOM' } };
    },
});

DELETE('/session/{session id}', {
    cmd: 'Delete Session',
    docs: 'https://github.com/jlipps/simple-wd-spec#delete-session',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);

        session.jsdom.window.close();
        ctx.sessions.delete(session_id);
    },
});

GET('/session/{session id}/timeouts', {
    cmd: 'Get Timeouts',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-timeouts',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/timeouts', {
    cmd: 'Set Timeouts',
    docs: 'https://github.com/jlipps/simple-wd-spec#set-timeouts',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/url', {
    cmd: 'Go',
    docs: 'https://github.com/jlipps/simple-wd-spec#go',
    validate(params, body) {},
    handle: async function handle({ session_id }, { url }) {
        const session = ctx.sessions.get(session_id);

        console.warn('GOING', session.jsdom.window.location.href, '->', url);
        session.jsdom = await JSDOM.fromURL(url, {
            referrer: session.jsdom.window.location.href,
            pretendToBeVisual: true,
            resources: resourceLoader,
            runScripts: 'dangerously',
            cookieJar: session.cookieJar,
            beforeParse(window) {
                // window.pageDataTracker = { trackPageLoad() {} };
                // new Proxy(window, {
                //     set(target, prop, value, receiver) {
                //         console.log(`LOCATION WAS SET TO ${value}`);
                //         Reflect.set(target, prop, value, receiver);
                //     },
                // });
                window.matchMedia =
                    window.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));
                window.Worker = class Worker {
                    constructor() {
                        console.warn('new Worker', [...arguments]);
                    }
                    postMessage({ op, args, messageId }) {
                        console.warn('Worker#postMessage', { op, args, messageId });

                        setTimeout(() => {
                            if (this.onmessage) {
                                if (op === 'index') {
                                    this.onmessage({ data: { op, messageId, value: true } });
                                }
                                if (op === 'search') {
                                    this.onmessage({ data: { op, messageId, value: [] } });
                                }
                            }
                        }, 10);
                    }
                };
            },
        });

        console.warn('GONE', session.jsdom.window.location.href);

        // session.jsdom.window.location = `https://google.com/`;

        // if (session.jsdom.window.location.href.endsWith('authorization.ping')) {
        //     console.log(session.cookieJar.getCookiesSync(session.jsdom.window.location.href).map(c => c.toJSON()));
        //     session.jsdom.window.eval(`
        //         console.log('INSIDE', window.location.href);
        //         console.log('snf cookie: ' + (getCookie('SNF') || '<EMPTY>'));
        //         console.log('document.cookie: ' + (document.cookie || '<EMPTY>'));
        //     `);
        // }
    },
});

GET('/session/{session id}/url', {
    cmd: 'Get Current URL',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-current-url',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);

        return session.jsdom.window.location.href;
    },
});

POST('/session/{session id}/back', {
    cmd: 'Back',
    docs: 'https://github.com/jlipps/simple-wd-spec#back',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/forward', {
    cmd: 'Forward',
    docs: 'https://github.com/jlipps/simple-wd-spec#forward',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/refresh', {
    cmd: 'Refresh',
    docs: 'https://github.com/jlipps/simple-wd-spec#refresh',
    validate(params, body) {},
    async handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);
        const old = session.jsdom;
        const { href } = session.jsdom.window.location;

        session.jsdom = await JSDOM.fromURL(href, {
            referrer: href,
            // resources: 'usable',
            pretendToBeVisual: true,
            resources: resourceLoader,
            cookieJar: session.cookieJar,
        });

        old.window.close();
    },
});

GET('/session/{session id}/title', {
    cmd: 'Get Title',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-title',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);

        return session.jsdom.window.document.title;
    },
});

GET('/session/{session id}/window', {
    cmd: 'Get Window Handle',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-handle',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

DELETE('/session/{session id}/window', {
    cmd: 'Close Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#close-window',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);

        session.jsdom.window.close();
    },
});

POST('/session/{session id}/window', {
    cmd: 'Switch To Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-window',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

GET('/session/{session id}/window/handles', {
    cmd: 'Get Window Handles',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-handles',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/frame', {
    cmd: 'Switch To Frame',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-frame',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/frame/parent', {
    cmd: 'Switch To Parent Frame',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-parent-frame',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

GET('/session/{session id}/window/rect', {
    cmd: 'Get Window Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-rect',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/window/rect', {
    cmd: 'Set Window Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#set-window-rect',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/window/maximize', {
    cmd: 'Maximize Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#maximize-window',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/window/minimize', {
    cmd: 'Minimize Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#minimize-window',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/window/fullscreen', {
    cmd: 'Fullscreen Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#fullscreen-window',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/element', {
    cmd: 'Find Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-element',
    validate(params, body) {},
    handle({ session_id }, { using, value }) {
        const session = ctx.sessions.get(session_id);

        switch (using) {
            case 'css selector': {
                const el = session.jsdom.window.document.querySelector(value);
                const id = session.getOrCreateElementId(el);

                return { [ELEMENT]: id };
            }
            default: {
                return Promise.reject({
                    type: 'unsupported operation',
                    message: `Finding an element using a "${using}" is not implemented yet`,
                });
            }
        }
    },
});

POST('/session/{session id}/elements', {
    cmd: 'Find Elements',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-elements',
    validate(params, body) {},
    handle({ session_id }, { using, value }) {
        const session = ctx.sessions.get(session_id);

        const result = [];

        switch (using) {
            case 'css selector': {
                const elements = session.jsdom.window.document.querySelectorAll(value);

                for (const el of elements) {
                    const id = session.getOrCreateElementId(el);
                    result.push(id);
                }

                break;
            }
            default: {
                return Promise.reject({
                    type: 'unsupported operation',
                    message: `Finding an element using a "${using}" is not implemented yet`,
                });
            }
        }

        // if (result.length === 0) {
        //     const root = session.jsdom.window.eval(`document.querySelector('#app-root')`);
        //     console.log(root.children.length);
        //     console.log(root.innerHTML);
        // }

        return result.map(id => {
            return { [ELEMENT]: id };
        });
    },
});

POST('/session/{session id}/element/{element id}/element', {
    cmd: 'Find Element From Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-element-from-element',
    validate(params, body) {},
    handle({ session_id, element_id }, { using, value }) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        switch (using) {
            case 'css selector': {
                const el = element.querySelector(value);
                const id = session.getOrCreateElementId(el);

                return { [ELEMENT]: id };
            }
            default: {
                return Promise.reject({
                    type: 'unsupported operation',
                    message: `Finding an element using a "${using}" is not implemented yet`,
                });
            }
        }
    },
});

POST('/session/{session id}/element/{element id}/elements', {
    cmd: 'Find Elements From Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-elements-from-element',
    validate(params, body) {},
    handle({ session_id, element_id }, { using, value }) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        const result = [];

        switch (using) {
            case 'css selector': {
                const elements = element.querySelectorAll(value);

                for (const el of elements) {
                    const id = session.getOrCreateElementId(el);
                    result.push(id);
                }

                break;
            }
            default: {
                return Promise.reject({
                    type: 'unsupported operation',
                    message: `Finding an element using a "${using}" is not implemented yet`,
                });
            }
        }

        return result.map(id => {
            return { [ELEMENT]: id };
        });
    },
});

GET('/session/{session id}/element/active', {
    cmd: 'Get Active Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-active-element',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.jsdom.window.document.activeElement;
        const id = session.getOrCreateElementId(element);

        return { [ELEMENT]: id };
    },
});

GET('/session/{session id}/element/{element id}/selected', {
    cmd: 'Is Element Selected',
    docs: 'https://github.com/jlipps/simple-wd-spec#is-element-selected',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        return element.matches(':checked');
    },
});

GET('/session/{session id}/element/{element id}/attribute/{attribute name}', {
    cmd: 'Get Element Attribute',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-attribute',
    validate(params, body) {},
    handle({ session_id, element_id, attribute_name }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        return element.getAttribute(attribute_name);
    },
});

GET('/session/{session id}/element/{element id}/property/{property name}', {
    cmd: 'Get Element Property',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-property',
    validate(params, body) {},
    handle({ session_id, element_id, property_name }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        return element[property_name];
    },
});

GET('/session/{session id}/element/{element id}/css/{css property name}', {
    cmd: 'Get Element CSS Value',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-css-value',
    validate(params, body) {},
    handle({ session_id, element_id, css_property_name }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);
        const styles = session.jsdom.window.getComputedStyle(element);

        return styles[css_property_name];
    },
});

GET('/session/{session id}/element/{element id}/text', {
    cmd: 'Get Element Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-text',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        // Note: JSDOM does not support .innerText
        // See: https://github.com/jsdom/jsdom/issues/1245#issuecomment-303884103
        return element.textContent.trim();
    },
});

GET('/session/{session id}/element/{element id}/name', {
    cmd: 'Get Element Tag Name',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-tag-name',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        return element.tagName;
    },
});

GET('/session/{session id}/element/{element id}/rect', {
    cmd: 'Get Element Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-rect',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);
    },
});

GET('/session/{session id}/element/{element id}/enabled', {
    cmd: 'Is Element Enabled',
    docs: 'https://github.com/jlipps/simple-wd-spec#is-element-enabled',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        return !element.disabled;
    },
});

POST('/session/{session id}/element/{element id}/click', {
    cmd: 'Element Click',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-click',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        element.click();
    },
});

POST('/session/{session id}/element/{element id}/clear', {
    cmd: 'Element Clear',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-clear',
    validate(params, body) {},
    handle({ session_id, element_id }, body) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        element.value = '';
    },
});

POST('/session/{session id}/element/{element id}/value', {
    cmd: 'Element Send Keys',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-send-keys',
    validate(params, body) {},
    handle({ session_id, element_id }, { text, value }) {
        const session = ctx.sessions.get(session_id);
        const element = session.getElement(element_id);

        if (element.tagName !== 'INPUT') return;

        if (element.type === 'text') {
            element.value += text;
        } else if (element.type === 'file') {
            console.error('Not implemented');
        } else {
            element.value = text;
        }
    },
});

GET('/session/{session id}/source', {
    cmd: 'Get Page Source',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-page-source',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);
        /** @type import('jsdom').JSDOM */
        const jsdom = session.jsdom;

        return jsdom.serialize();
    },
});

POST('/session/{session id}/execute/sync', {
    cmd: 'Execute Script',
    docs: 'https://github.com/jlipps/simple-wd-spec#execute-script',
    validate(params, body) {},
    handle({ session_id }, { script, args }) {
        const session = ctx.sessions.get(session_id);
        /** @type import('jsdom').JSDOM */
        const jsdom = session.jsdom;

        switch (script) {
            case SELENIUM_SCRIPTS.isDisplayed: {
                const element_id = args[0][ELEMENT];
                const element = session.getElement(element_id);

                // console.log(element.parentElement.innerHTML);
                // console.log(session.jsdom.window.document.querySelectorAll('[role="row"]'));

                return toBeVisible(element).pass;
            }
            // TODO: other canned selenium-scripts
            default: {
                const hash = require('crypto')
                    .createHash('md5')
                    .update(script)
                    .digest()
                    .toString('hex');
                writeSeleniumScript(hash, script);
            }
        }

        return jsdom.window.eval(`
            (function() {
                const args = ${JSON.stringify(args)}.map( arg => {
                    if( !arg || typeof arg !== 'object' ) return arg;
                    if( '${ELEMENT}' in arg ) {
                        return window.__GET_ELEMENT__(arg['${ELEMENT}']);
                    }

                    return arg;
                });

                return (function() { ${script} })(...args);
            })();
        `);
    },
});

POST('/session/{session id}/execute/async', {
    cmd: 'Execute Async Script',
    docs: 'https://github.com/jlipps/simple-wd-spec#execute-async-script',
    validate(params, body) {},
    handle({ session_id }, { script, args }) {
        const session = ctx.sessions.get(session_id);
        /** @type import('jsdom').JSDOM */
        const jsdom = session.jsdom;

        return jsdom.window.eval(`
            (function() {
                const args = ${JSON.stringify(args)}.map( arg => {
                    if( !arg || typeof arg !== 'object' ) return arg;
                    if( '${ELEMENT}' in arg ) {
                        return window.__GET_ELEMENT__(arg['${ELEMENT}']);
                    }

                    return arg;
                });

                return new Promise(cb => {
                    args.push(cb);
                    (function() { ${script} })(...args);
                });
            })();
        `);
    },
});

GET('/session/{session id}/cookie', {
    cmd: 'Get All Cookies',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-all-cookies',
    validate(params, body) {},
    handle({ session_id }, { params }) {
        const session = ctx.sessions.get(session_id);
        const currentUrl = session.jsdom.window.location.href;
        const cookies = session.cookieJar.getCookiesSync(currentUrl);

        return cookies.map(cookie => {
            const { key: name, value, path, domain, secure, httpOnly, maxAge: expiry } = cookie;
            return { name, value, path, domain, secure, httpOnly, expiry };
        });
    },
});

GET('/session/{session id}/cookie/{cookie name}', {
    cmd: 'Get Named Cookie',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-named-cookie',
    validate(params, body) {},
    handle({ session_id, cookie_name }, body) {
        const session = ctx.sessions.get(session_id);
        const currentUrl = session.jsdom.window.location.href;
        const cookies = session.cookieJar.getCookiesSync(currentUrl);
        const cookie = cookies.find(c => c.key === cookie_name);

        if (!cookie) {
            throw { status: 500, type: 'no such cookie', message: `No cookie exists with key: '${cookie_name}` };
        }

        const { key: name, value, path, domain, secure, httpOnly, maxAge: expiry } = cookie;
        return { name, value, path, domain, secure, httpOnly, expiry };
    },
});

POST('/session/{session id}/cookie', {
    cmd: 'Add Cookie',
    docs: 'https://github.com/jlipps/simple-wd-spec#add-cookie',
    validate(params, body) {},
    handle({ session_id }, { cookie }) {
        const session = ctx.sessions.get(session_id);
        const currentUrl = session.jsdom.window.location.href;
        let { name, value, domain, expiry, ...options } = cookie;

        if (domain && domain.startsWith('.')) {
            domain = domain.slice(1);
            options.hostOnly = false;
        }

        session.cookieJar.setCookieSync(
            new Cookie({
                key: name,
                value,
                maxAge: expiry,
                domain,
                ...options,
            }),
            currentUrl,
        );

        // const { name, value, ...options } = cookie;

        // const cookieString =
        //     `${name}=${value}` +
        //     Object.entries(options)
        //         .map(([key, val]) => {
        //             if (val == null) return '';
        //             if (key === 'expiry') key = 'max-age';

        //             return `;${key}=${val}`;
        //         })
        //         .join('');

        // cookieJar.setCookieSync(cookieString, currentUrl);
    },
});

DELETE('/session/{session id}/cookie/{cookie name}', {
    cmd: 'Delete Cookie',
    docs: 'https://github.com/jlipps/simple-wd-spec#delete-cookie',
    validate(params, body) {},
    handle({ session_id, cookie_name }, body) {
        const session = ctx.sessions.get(session_id);
        const currentUrl = session.jsdom.window.location.href;
        const cookies = cookieJar.getCookiesSync(currentUrl);
        const cookie = cookies.find(c => c.key === cookie_name);

        cookie.setMaxAge(-1);
        cookie.value = null;
    },
});

DELETE('/session/{session id}/cookie', {
    cmd: 'Delete All Cookies',
    docs: 'https://github.com/jlipps/simple-wd-spec#delete-all-cookies',
    validate(params, body) {},
    handle({ session_id }, body) {
        const session = ctx.sessions.get(session_id);
        const currentUrl = session.jsdom.window.location.href;
        const cookies = cookieJar.getCookiesSync(currentUrl);

        for (const cookie of cookies) {
            cookie.setMaxAge(-1);
            cookie.value = null;
        }
    },
});

POST('/session/{session id}/actions', {
    cmd: 'Perform Actions',
    docs: 'https://github.com/jlipps/simple-wd-spec#perform-actions',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

DELETE('/session/{session id}/actions', {
    cmd: 'Release Actions',
    docs: 'https://github.com/jlipps/simple-wd-spec#release-actions',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/alert/dismiss', {
    cmd: 'Dismiss Alert',
    docs: 'https://github.com/jlipps/simple-wd-spec#dismiss-alert',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/alert/accept', {
    cmd: 'Accept Alert',
    docs: 'https://github.com/jlipps/simple-wd-spec#accept-alert',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

GET('/session/{session id}/alert/text', {
    cmd: 'Get Alert Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-alert-text',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

POST('/session/{session id}/alert/text', {
    cmd: 'Send Alert Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#send-alert-text',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

GET('/session/{session id}/screenshot', {
    cmd: 'Take Screenshot',
    docs: 'https://github.com/jlipps/simple-wd-spec#take-screenshot',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

GET('/session/{session id}/element/{element id}/screenshot', {
    cmd: 'Take Element Screenshot',
    docs: 'https://github.com/jlipps/simple-wd-spec#take-element-screenshot',
    validate(params, body) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(params, body) {},
});

const startServer = port => {
    app.listen(port, function() {
        console.log('Server started on port ' + this.address().port);
    });
};

module.exports = { startServer };
