const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { JSDOM, ResourceLoader, CookieJar } = require('jsdom');
const { Cookie } = require('tough-cookie');
const isDocker = require('is-docker');
const { toBeVisible } = require('@testing-library/jest-dom/dist/to-be-visible');
const stringSimilarity = require('string-similarity');

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

const cacheSeleniumScriptForComparison = (command) => {
    const scriptPath = require.resolve(`selenium-webdriver/lib/atoms/${command}.js`);
    const script = fs.readFileSync(scriptPath, 'utf-8');

    SELENIUM_SCRIPTS[command] = script;
};

const SELENIUM_SCRIPTS = {};
cacheSeleniumScriptForComparison('is-displayed');
cacheSeleniumScriptForComparison('get-attribute');

const REQUEST =
    (method, app) =>
    (path, { cmd, validate, handle }) => {
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

            const { session_id, element_id } = req.params;
            const session = ctx.sessions.get(session_id);
            const element = session && session.getElement(element_id);
            const args = { ...req.params, ...req.body, session, element };
            const error = await validate(args);

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
                const result = await handle(args);
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
    validate() {},
    handle() {
        return { ready: true, message: 'server ready' };
    },
});

POST('/session', {
    cmd: 'New Session',
    docs: 'https://github.com/jlipps/simple-wd-spec#new-session',
    validate() {},
    handle(args) {
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
                    ((id) => {
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
    validate(args) {},
    handle({ session_id, session }) {
        session.jsdom.window.close();
        ctx.sessions.delete(session_id);
    },
});

GET('/session/{session id}/timeouts', {
    cmd: 'Get Timeouts',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-timeouts',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/timeouts', {
    cmd: 'Set Timeouts',
    docs: 'https://github.com/jlipps/simple-wd-spec#set-timeouts',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/url', {
    cmd: 'Go',
    docs: 'https://github.com/jlipps/simple-wd-spec#go',
    validate(args) {},
    async handle({ session, url }) {
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
    validate(args) {},
    handle({ session }) {
        return session.jsdom.window.location.href;
    },
});

POST('/session/{session id}/back', {
    cmd: 'Back',
    docs: 'https://github.com/jlipps/simple-wd-spec#back',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/forward', {
    cmd: 'Forward',
    docs: 'https://github.com/jlipps/simple-wd-spec#forward',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/refresh', {
    cmd: 'Refresh',
    docs: 'https://github.com/jlipps/simple-wd-spec#refresh',
    validate(args) {},
    async handle({ session }) {
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
    validate(args) {},
    handle({ session }) {
        return session.jsdom.window.document.title;
    },
});

GET('/session/{session id}/window', {
    cmd: 'Get Window Handle',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-handle',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

DELETE('/session/{session id}/window', {
    cmd: 'Close Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#close-window',
    validate(args) {},
    handle({ session }) {
        session.jsdom.window.close();
    },
});

POST('/session/{session id}/window', {
    cmd: 'Switch To Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-window',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

GET('/session/{session id}/window/handles', {
    cmd: 'Get Window Handles',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-handles',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/frame', {
    cmd: 'Switch To Frame',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-frame',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/frame/parent', {
    cmd: 'Switch To Parent Frame',
    docs: 'https://github.com/jlipps/simple-wd-spec#switch-to-parent-frame',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

GET('/session/{session id}/window/rect', {
    cmd: 'Get Window Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-window-rect',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/window/rect', {
    cmd: 'Set Window Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#set-window-rect',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/window/maximize', {
    cmd: 'Maximize Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#maximize-window',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/window/minimize', {
    cmd: 'Minimize Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#minimize-window',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/window/fullscreen', {
    cmd: 'Fullscreen Window',
    docs: 'https://github.com/jlipps/simple-wd-spec#fullscreen-window',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/element', {
    cmd: 'Find Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-element',
    validate(args) {},
    handle({ session, using, value }) {
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
    validate(args) {},
    handle({ session, using, value }) {
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

        return result.map((id) => {
            return { [ELEMENT]: id };
        });
    },
});

POST('/session/{session id}/element/{element id}/element', {
    cmd: 'Find Element From Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#find-element-from-element',
    validate(args) {},
    handle({ session, element, using, value }) {
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
    validate(args) {},
    handle({ session, element, using, value }) {
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

        return result.map((id) => {
            return { [ELEMENT]: id };
        });
    },
});

GET('/session/{session id}/element/active', {
    cmd: 'Get Active Element',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-active-element',
    validate(args) {},
    handle({ session }) {
        const element = session.jsdom.window.document.activeElement;
        const id = session.getOrCreateElementId(element);

        return { [ELEMENT]: id };
    },
});

GET('/session/{session id}/element/{element id}/selected', {
    cmd: 'Is Element Selected',
    docs: 'https://github.com/jlipps/simple-wd-spec#is-element-selected',
    validate(args) {},
    handle({ session, element }) {
        return element.matches(':checked');
    },
});

GET('/session/{session id}/element/{element id}/attribute/{attribute name}', {
    cmd: 'Get Element Attribute',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-attribute',
    validate(args) {},
    handle({ session, element, attribute_name }) {
        return element.getAttribute(attribute_name);
    },
});

GET('/session/{session id}/element/{element id}/property/{property name}', {
    cmd: 'Get Element Property',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-property',
    validate(args) {},
    handle({ session, element, property_name }) {
        return element[property_name];
    },
});

GET('/session/{session id}/element/{element id}/css/{css property name}', {
    cmd: 'Get Element CSS Value',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-css-value',
    validate(args) {},
    handle({ session, element, css_property_name }) {
        const styles = session.jsdom.window.getComputedStyle(element);

        return styles[css_property_name];
    },
});

GET('/session/{session id}/element/{element id}/text', {
    cmd: 'Get Element Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-text',
    validate(args) {},
    handle({ session, element }) {
        // Note: JSDOM does not support .innerText
        // See: https://github.com/jsdom/jsdom/issues/1245#issuecomment-303884103
        return element.textContent.trim();
    },
});

GET('/session/{session id}/element/{element id}/name', {
    cmd: 'Get Element Tag Name',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-tag-name',
    validate(args) {},
    handle({ session, element }) {
        return element.tagName;
    },
});

GET('/session/{session id}/element/{element id}/rect', {
    cmd: 'Get Element Rect',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-element-rect',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle({ session, element }) {},
});

GET('/session/{session id}/element/{element id}/enabled', {
    cmd: 'Is Element Enabled',
    docs: 'https://github.com/jlipps/simple-wd-spec#is-element-enabled',
    validate(args) {},
    handle({ session, element }) {
        return !element.disabled;
    },
});

POST('/session/{session id}/element/{element id}/click', {
    cmd: 'Element Click',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-click',
    validate(args) {},
    handle({ session, element }) {
        element.click();
    },
});

POST('/session/{session id}/element/{element id}/clear', {
    cmd: 'Element Clear',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-clear',
    validate(args) {},
    handle({ session, element }) {
        element.value = '';
    },
});

POST('/session/{session id}/element/{element id}/value', {
    cmd: 'Element Send Keys',
    docs: 'https://github.com/jlipps/simple-wd-spec#element-send-keys',
    validate(args) {},
    handle({ session, element, text, value }) {
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
    validate(args) {},
    handle({ session }) {
        return session.jsdom.serialize();
    },
});

POST('/session/{session id}/execute/sync', {
    cmd: 'Execute Script',
    docs: 'https://github.com/jlipps/simple-wd-spec#execute-script',
    validate(args) {},
    handle({ session, script, args }) {
        const { bestMatch } = stringSimilarity.findBestMatch(script, [...Object.values(SELENIUM_SCRIPTS)]);

        if (bestMatch.rating >= 0.99) {
            switch (bestMatch.target) {
                case SELENIUM_SCRIPTS['is-displayed']: {
                    const element_id = args[0][ELEMENT];
                    const element = session.getElement(element_id);

                    return toBeVisible(element).pass;
                }
                // TODO: other canned selenium-scripts
                case SELENIUM_SCRIPTS['get-attribute']:
                    break;
            }
        } else console.log(bestMatch.rating);

        return session.jsdom.window.eval(`
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
    validate(args) {},
    handle({ session, script, args }) {
        return session.jsdom.window.eval(`
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
    validate(args) {},
    handle({ session }) {
        const currentUrl = session.jsdom.window.location.href;
        const cookies = session.cookieJar.getCookiesSync(currentUrl);

        return cookies.map((cookie) => {
            const { key: name, value, path, domain, secure, httpOnly, maxAge: expiry } = cookie;
            return { name, value, path, domain, secure, httpOnly, expiry };
        });
    },
});

GET('/session/{session id}/cookie/{cookie name}', {
    cmd: 'Get Named Cookie',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-named-cookie',
    validate(args) {},
    handle({ session, cookie_name }) {
        const currentUrl = session.jsdom.window.location.href;
        const cookies = session.cookieJar.getCookiesSync(currentUrl);
        const cookie = cookies.find((c) => c.key === cookie_name);

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
    validate(args) {},
    handle({ session, cookie }) {
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
    validate(args) {},
    handle({ session, cookie_name }) {
        const currentUrl = session.jsdom.window.location.href;
        const cookies = cookieJar.getCookiesSync(currentUrl);
        const cookie = cookies.find((c) => c.key === cookie_name);

        cookie.setMaxAge(-1);
        cookie.value = null;
    },
});

DELETE('/session/{session id}/cookie', {
    cmd: 'Delete All Cookies',
    docs: 'https://github.com/jlipps/simple-wd-spec#delete-all-cookies',
    validate(args) {},
    handle({ session }) {
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
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

DELETE('/session/{session id}/actions', {
    cmd: 'Release Actions',
    docs: 'https://github.com/jlipps/simple-wd-spec#release-actions',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/alert/dismiss', {
    cmd: 'Dismiss Alert',
    docs: 'https://github.com/jlipps/simple-wd-spec#dismiss-alert',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/alert/accept', {
    cmd: 'Accept Alert',
    docs: 'https://github.com/jlipps/simple-wd-spec#accept-alert',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

GET('/session/{session id}/alert/text', {
    cmd: 'Get Alert Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#get-alert-text',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

POST('/session/{session id}/alert/text', {
    cmd: 'Send Alert Text',
    docs: 'https://github.com/jlipps/simple-wd-spec#send-alert-text',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

GET('/session/{session id}/screenshot', {
    cmd: 'Take Screenshot',
    docs: 'https://github.com/jlipps/simple-wd-spec#take-screenshot',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

GET('/session/{session id}/element/{element id}/screenshot', {
    cmd: 'Take Element Screenshot',
    docs: 'https://github.com/jlipps/simple-wd-spec#take-element-screenshot',
    validate(args) {
        console.error('Not implemented');
        // prettier-ignore
        return {/* not implemented */};
    },
    handle(args) {},
});

const startServer = (port) => {
    return app.listen(port, function () {
        console.log('Server started on port ' + this.address().port);
    });
};

module.exports = { startServer };
