const http = require('http');
const { until } = require('selenium-webdriver');
const { ServiceBuilder, Driver, getDefaultService } = require('./webdriver');
const { startServer } = require('./server');

process.on('unhandledPromiseRejected', err => {
    console.log(err);
});

/**
 * @param req { http.IncomingMessage }
 * @param res { http.ServerResponse }
 */
function serverHandler(req, res) {
    if (req.url === '/') {
        return res.end(`
<html>
<head>
    <title>Test App</title>
</head>
<body>
    <h1>My Test App</h1>
    <div id="root" data-foo="bar"></div>
</body>
</html>
        `);
    }

    if (req.url === '/cookies') {
        return res.end(`
<html>
<head>
    <title>Cookies | Test App</title>
</head>
<body>
    <h1>My Test App</h1>
    <div id="root">
        <dl>
            ${(req.headers.cookie || '')
                .split(/;\s?/)
                .filter(Boolean)
                .map(pair => pair.split('='))
                .map(([key, val]) => `<dt>${key}</dt><dd>${val}</dd>`)
                .join('\n')}
        </dl>
    </div>
</body>
</html>
        `);
    }

    if (req.url === '/interactive') {
        return res.end(`
<html>
<head>
    <title>Interactive | Test App</title>
</head>
<body>
    <h1>My Test App</h1>
    <div id="root">
        <label id="label-A"><input type="checkbox" name="option-A" /> A</label>
        <label id="label-B"><input type="checkbox" name="option-B" /> B</label>
        <label id="label-C"><input type="checkbox" name="option-C" /> C</label>
        <label id="label-toggle-all">
            <input type="checkbox" name="option-toggle-all" />
            <span>All of the above</span>
        </label>
        <label id="label-other">
            <input type="checkbox" name="option-other" />
            Other
            <input type="text" name="input-other" placeholder="Please specify others" disabled />
        </label>
    </div>
    <script>
        const root = document.querySelector('#root');
        const checkboxA = document.querySelector('input[name="option-A"]');
        const checkboxB = document.querySelector('input[name="option-B"]');
        const checkboxC = document.querySelector('input[name="option-C"]');
        const toggleCheckbox = document.querySelector('#label-toggle-all input');
        const checkboxOther = document.querySelector('input[name="option-other"]');
        const inputOther = document.querySelector('input[name="input-other"]');

        toggleCheckbox.addEventListener('change', e => {
            [checkboxA, checkboxB, checkboxC].forEach( cb => {
                cb.checked = toggleCheckbox.checked;
            });
        });

        root.addEventListener('change', e => {
            const checkboxes = [checkboxA, checkboxB, checkboxC];

            if( checkboxes.includes(e.target) ) {
                toggleCheckbox.checked = checkboxes.every( cb => cb.checked );
            }
        });

        checkboxOther.addEventListener('change', e => {
            inputOther.style.display = checkboxOther.checked ? 'initial' : 'none';
            inputOther.disabled = !checkboxOther.checked;
        });
    </script>
</body>
</html>
        `);
    }
}

/** @type http.Server */
let server;
/** @type import('selenium-webdriver/remote').DriverService */
let service;
/** @type import('selenium-webdriver').WebDriver */
let driver;

/** @type http.Server */
let mockAppServer;
let url = 'http://localhost:...';
const getUrl = (path = '/') => url + path;

beforeAll(async () => {
    mockAppServer = http.createServer(serverHandler);
    await new Promise(resolve => {
        mockAppServer.listen(() => {
            url = `http://localhost:${mockAppServer.address().port}`;
            console.log(`Test server available at ${url}`);
            resolve(mockAppServer);
        });
    });

    server = startServer();

    service = new ServiceBuilder()
        .setStdio('inherit')
        .setPort(server.address().port)
        .build();
});

beforeEach(() => {
    driver = Driver.createSession(undefined, service);
});

afterEach(async () => {
    await driver.quit();
});
afterAll(async () => {
    mockAppServer.close();
    service.kill();
});

test('root', async () => {
    await driver.get(getUrl('/'));

    expect(await driver.getCurrentUrl()).toBe(getUrl('/'));
    expect(await driver.getTitle()).toBe('Test App');

    /** @type import('selenium-webdriver').WebElement */
    var root = await driver.wait(until.elementLocated({ css: '#root' }));

    await expect(root.findElements({ css: '*' })).resolves.toHaveLength(0);
    await expect(root.getTagName()).resolves.toBe('DIV');
    // await expect(root.getAttribute('data-foo')).resolves.toBe('bar');
    await expect(root.getCssValue('display')).resolves.toBe('block');

    await expect(driver.executeScript(`const [a, b] = arguments; return a + b;`, 1, 2)).resolves.toBe(3);
    await expect(driver.executeAsyncScript(`const [a, b, cb] = arguments; cb(a + b);`, 1, 2)).resolves.toBe(3);

    await driver.navigate().refresh();
    await expect(root.findElements({ css: '*' })).rejects.toEqual(expect.any(Error));

    // prettier-ignore
    await expect(driver.switchTo().activeElement().getTagName()).resolves.toBe('BODY');

    const cleanHtml = html => html.replace(/>\s+</g, '><').trim();
    const pageSource = cleanHtml(await driver.getPageSource());
    expect(pageSource).toBe(
        cleanHtml(`
            <html>
            <head>
                <title>Test App</title>
            </head>
            <body>
                <h1>My Test App</h1>
                <div id="root" data-foo="bar"></div>
            </body>
            </html>
        `),
    );
});

test('cookies', async () => {
    await driver.get(getUrl('/cookies'));

    await expect(driver.getCurrentUrl()).resolves.toBe(getUrl('/cookies'));
    await expect(driver.getTitle()).resolves.toBe('Cookies | Test App');

    await expect(driver.findElements({ css: 'dl *' })).resolves.toHaveLength(0);

    await driver.manage().addCookie({ name: 'first', value: '1st' });
    await driver.navigate().refresh();
    await driver.manage().addCookie({ name: 'second', value: '2nd' });

    await expect(driver.findElements({ css: 'dl *' })).resolves.toHaveLength(2);
    await expect(driver.findElement({ css: 'dl dt' }).getText()).resolves.toBe('first');
    await expect(driver.findElement({ css: 'dl dd' }).getText()).resolves.toBe('1st');

    await driver.navigate().refresh();

    await expect(driver.findElements({ css: 'dl *' })).resolves.toHaveLength(4);
    await expect(driver.findElement({ css: 'dl dt:nth-of-type(1)' }).getText()).resolves.toBe('first');
    await expect(driver.findElement({ css: 'dl dd:nth-of-type(1)' }).getText()).resolves.toBe('1st');
    await expect(driver.findElement({ css: 'dl dt:nth-of-type(2)' }).getText()).resolves.toBe('second');
    await expect(driver.findElement({ css: 'dl dd:nth-of-type(2)' }).getText()).resolves.toBe('2nd');
});

test.only('interactive', async () => {
    await driver.get(getUrl('/interactive'));

    await expect(driver.getCurrentUrl()).resolves.toBe(getUrl('/interactive'));
    await expect(driver.getTitle()).resolves.toBe('Interactive | Test App');

    const root = driver.wait(until.elementLocated({ css: '#root' }));
    const labelA = root.findElement({ css: '#label-A' });
    const labelB = root.findElement({ css: '#label-B' });
    const labelC = root.findElement({ css: '#label-C' });
    const labelToggleAll = root.findElement({ css: '#label-toggle-all' });
    const labelOther = root.findElement({ css: '#label-other' });
    const checkboxA = labelA.findElement({ css: 'input' });
    const checkboxB = labelB.findElement({ css: 'input' });
    const checkboxC = labelC.findElement({ css: 'input' });
    const checkboxToggleAll = labelToggleAll.findElement({ css: 'input' });
    const checkboxOther = labelOther.findElement({ css: 'input[type="checkbox"]' });
    const inputOther = labelOther.findElement({ css: 'input[type="text"]' });

    await expect(labelA.getText()).resolves.toBe('A');
    await expect(labelB.getText()).resolves.toBe('B');
    await expect(labelC.getText()).resolves.toBe('C');
    await expect(labelToggleAll.getText()).resolves.toBe('All of the above');

    await expect(checkboxA.getAttribute('name')).resolves.toBe('option-A');
    await expect(checkboxB.getAttribute('name')).resolves.toBe('option-B');
    await expect(checkboxC.getAttribute('name')).resolves.toBe('option-C');
    await expect(checkboxToggleAll.getAttribute('name')).resolves.toBe('option-toggle-all');

    async function expectSelected(a, b, c, all) {
        await expect(checkboxA.isSelected()).resolves.toBe(a);
        await expect(checkboxB.isSelected()).resolves.toBe(b);
        await expect(checkboxC.isSelected()).resolves.toBe(c);
        await expect(checkboxToggleAll.isSelected()).resolves.toBe(all);
    }

    await expectSelected(false, false, false, false);

    await labelA.click();
    await expectSelected(true, false, false, false);

    await checkboxToggleAll.click();
    await expectSelected(true, true, true, true);

    await checkboxToggleAll.click();
    await expectSelected(false, false, false, false);

    await expect(inputOther.isDisplayed()).resolves.toBe(false);
    await expect(inputOther.isEnabled()).resolves.toBe(false);

    await checkboxOther.click();

    await driver.wait(until.elementIsVisible(inputOther));
    await expect(inputOther.isDisplayed()).resolves.toBe(true);
    await expect(inputOther.isEnabled()).resolves.toBe(true);

    await inputOther.sendKeys('Looking for D');
    await expect(inputOther.getAttribute('value')).resolves.toBe('Looking for D');

    await inputOther.clear();
    await inputOther.sendKeys('😳');
    await expect(inputOther.getAttribute('value')).resolves.toBe('😳');
});
