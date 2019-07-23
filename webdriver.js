const fs = require('fs');
const util = require('util');
const path = require('path');

const http = require('selenium-webdriver/http');
const io = require('selenium-webdriver/io');
const remote = require('selenium-webdriver/remote');
const webdriver = require('selenium-webdriver/lib/webdriver');
const { Browser, Capabilities } = require('selenium-webdriver/lib/capabilities');

/**
 * _Synchronously_ attempts to locate the jsdom driver executable on the current
 * system.
 *
 * @return {?string} the located executable, or `null`.
 */
function locateSynchronously() {
    const filename = {
        win32: 'jsdom-webdriver-win.exe',
        darwin: 'jsdom-webdriver-macos',
        linux: 'jsdom-webdriver-linux',
    }[process.platform];

    return path.resolve(__dirname, './bin/' + filename);
}

/**
 * Class for managing JSDOMDriver specific options.
 */
class Options extends Capabilities {
    /**
     * @param {(Capabilities|Map<string, ?>|Object)=} other Another set of
     *     capabilities to initialize this instance from.
     */
    constructor(other = undefined) {
        super(other);
        this.setBrowserName('JSDOM');
    }
}

/**
 * Creates {@link remote.DriverService} instances that manage a
 * JSDOMDriver server in a child process.
 */
class ServiceBuilder extends remote.DriverService.Builder {
    /**
     * @param {string=} opt_exe Path to the server executable to use. If omitted,
     *   the builder will use the locally installed binary.
     */
    constructor(opt_exe) {
        let exe = opt_exe || locateSynchronously();

        super(exe);

        // Binding to the loopback address will fail if not running with
        // administrator privileges. Since we cannot test for that in script
        // (or can we?), force the DriverService to use "localhost".
        this.setHostname('localhost');
    }

    /**
     * Enables verbose logging.
     * @return {!ServiceBuilder} A self reference.
     */
    enableVerboseLogging() {
        return this.addArguments('--verbose');
    }
}

/** @type {remote.DriverService} */
var defaultService = null;

/**
 * Sets the default service to use for new JSDOMDriver instances.
 * @param {!remote.DriverService} service The service to use.
 * @throws {Error} If the default service is currently running.
 */
function setDefaultService(service) {
    if (defaultService && defaultService.isRunning()) {
        throw Error(
            'The previously configured JSDOMDriver service is still running. ' +
                'You must shut it down before you may adjust its configuration.',
        );
    }
    defaultService = service;
}

/**
 * Returns the default JSDOMDriver service. If such a service has
 * not been configured, one will be constructed using the default configuration
 * for a JSDOMDriver executable found on the system PATH.
 * @return {!remote.DriverService} The default JSDOMDriver service.
 */
function getDefaultService() {
    if (!defaultService) {
        defaultService = new ServiceBuilder().build();
    }
    return defaultService;
}

/**
 * Creates a new WebDriver client for JSDOM.
 */
class JSDOMDriver extends webdriver.WebDriver {
    /**
     * Creates a new browser session in JSDOM and starts the service, if not already started.
     *
     * @param {(Capabilities|Options)=} options The configuration options.
     * @param {remote.DriverService=} service The session to use; will use
     *     the {@linkplain #getDefaultService default service} by default.
     * @return {!JSDOMDriver} A new driver instance.
     */
    static createSession(options, opt_service) {
        let service = opt_service || getDefaultService();
        let client = service.start().then(url => new http.HttpClient(url));
        let executor = new http.Executor(client);

        options = options || new Options();
        return /** @type {!JSDOMDriver} */ (super.createSession(executor, options, () => service.kill()));
    }

    /**
     * Creates a new browser session in JSDOM.
     *
     * @param {(Capabilities|Options)=} options The configuration options.
     * @param {string} url the address of an existing JSDOM server instance e.g. http://localhost:3000
     * @return {!JSDOMDriver} A new driver instance.
     */
    static createSessionWithExistingService(options, url) {
        let client = new http.HttpClient(url);
        let executor = new http.Executor(client);

        options = options || new Options();
        return /** @type {!JSDOMDriver} */ (super.createSession(executor, options));
    }

    /**
     * This function is a no-op as file detectors are not supported by this
     * implementation.
     * @override
     */
    setFileDetector() {}
}

// PUBLIC API

exports.Driver = JSDOMDriver;
exports.Options = Options;
exports.ServiceBuilder = ServiceBuilder;
exports.getDefaultService = getDefaultService;
exports.setDefaultService = setDefaultService;
exports.locateSynchronously = locateSynchronously;
