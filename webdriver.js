const fs = require('fs');
const util = require('util');
const path = require('path');

const http = require('selenium-webdriver/http');
const io = require('selenium-webdriver/io');
const remote = require('selenium-webdriver/remote');
const webdriver = require('selenium-webdriver/lib/webdriver');
const { Browser, Capabilities } = require('selenium-webdriver/lib/capabilities');

const JSDOM_DRIVER_EXE = {
    win32: 'jsdom-webdriver-win.exe',
    darwin: 'jsdom-webdriver-macos',
    linux: 'jsdom-webdriver-linux',
}[process.platform];

/**
 * _Synchronously_ attempts to locate the edge driver executable on the current
 * system.
 *
 * @return {?string} the located executable, or `null`.
 */
function locateSynchronously() {
    return io.findInPath(JSDOM_DRIVER_EXE, true);
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
     *   the builder will attempt to locate the MicrosoftEdgeDriver on the current
     *   PATH.
     * @throws {Error} If provided executable does not exist, or the
     *   MicrosoftEdgeDriver cannot be found on the PATH.
     */
    constructor(opt_exe) {
        let exe = opt_exe || locateSynchronously();
        if (!exe) {
            throw Error('The jsdom-webdriver binary could not be found.');
        }

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
 * Sets the default service to use for new MicrosoftEdgeDriver instances.
 * @param {!remote.DriverService} service The service to use.
 * @throws {Error} If the default service is currently running.
 */
function setDefaultService(service) {
    if (defaultService && defaultService.isRunning()) {
        throw Error(
            'The previously configured EdgeDriver service is still running. ' +
                'You must shut it down before you may adjust its configuration.',
        );
    }
    defaultService = service;
}

/**
 * Returns the default MicrosoftEdgeDriver service. If such a service has
 * not been configured, one will be constructed using the default configuration
 * for an MicrosoftEdgeDriver executable found on the system PATH.
 * @return {!remote.DriverService} The default MicrosoftEdgeDriver service.
 */
function getDefaultService() {
    if (!defaultService) {
        const builder = new ServiceBuilder();
        // if (process.env.NODE_ENV === 'test') {
        builder.setStdio('inherit');
        // }
        defaultService = builder.build();
    }
    return defaultService;
}

/**
 * Creates a new WebDriver client for Microsoft's Edge.
 */
class Driver extends webdriver.WebDriver {
    /**
     * Creates a new browser session for Microsoft's Edge browser.
     *
     * @param {(Capabilities|Options)=} options The configuration options.
     * @param {remote.DriverService=} service The session to use; will use
     *     the {@linkplain #getDefaultService default service} by default.
     * @return {!Driver} A new driver instance.
     */
    static createSession(options, opt_service) {
        let service = opt_service || getDefaultService();
        let client = service.start().then(url => new http.HttpClient(url));
        let executor = new http.Executor(client);

        options = options || new Options();
        return /** @type {!Driver} */ (super.createSession(executor, options, () => service.kill()));
    }

    /**
     * This function is a no-op as file detectors are not supported by this
     * implementation.
     * @override
     */
    setFileDetector() {}
}

// PUBLIC API

exports.Driver = Driver;
exports.Options = Options;
exports.ServiceBuilder = ServiceBuilder;
exports.getDefaultService = getDefaultService;
exports.setDefaultService = setDefaultService;
exports.locateSynchronously = locateSynchronously;
