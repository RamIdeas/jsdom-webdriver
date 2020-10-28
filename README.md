# JSDOM WebDriver

A JSDOM implementation of the WebDriver spec

## Why

I was asked to speed up the build pipeline of a project. It's E2E testing phase used cucumber-js and selenium and took over an hour to run.

Most of the tests were functionality you could test against JSDOM. Rather than recommend the arduous task of rewriting their tests using something like @testing-library/\*, I figured we could tag a majority of the test scenarios as runnable against a JSDOM WebDriver rather than the Chrome or Firefox WebDriver.

Rather than starting an instance of a browser for each test and instead using JSDOM in Node.js, we can dramatically decrease the run time.

## How to use it

A binary is created for each platform:

-   Windows: `./bin/jsdom-webdriver-win.exe`
-   Mac OS X: `./bin/jsdom-webdriver-macos`
-   Linux: `./bin/jsdom-webdriver-linux`

In your setup file where you point to other drivers, point to this binary by filepath instead.

## Pitfalls

This WebDriver has the same pitfalls as JSDOM, namely:

1.  Any code that relys on layout/scroll (e.g. `getBoundlingClientRect` or `scrollTop`) won't work
2.  Any client-side navigation (`window.location.href = '...'` or `window.location.assign('...')`) won't work

## Contribute

I only implemented the commands I needed, there are a few still to go.

To set up a watcher to build the binary on each change, run: `npm run build:watch`.

If you are on a Mac or Linux machine, you can avoid the (relatively short) binary build by running either `npm run buiid:dev:macos` or `npm run build:dev:linux` which will create a bash file which will simply run your source file in `node`.

In a seperate terminal, you can run the tests `npm run test:watch`.

On Mac and Linux machines, for convenience, you can stay in one terminal and only run one command: `npm run test:watch:macos` or `npm run test:watch:linux`.

### Recommendation: TDD

Before implementing or modifying a command, I recommend you add a failing assertion to the tests. Selenium can be a bit unpredictable when it comes to which commands are executed by which method, so it'll definitely save you time and headache to do this first.
