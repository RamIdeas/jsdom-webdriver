const { startServer } = require('./server');
const arg = require('arg');

const args = arg({
    // Types
    '--help': Boolean,
    '--version': Boolean,
    '--verbose': arg.COUNT, // Counts the number of times --verbose is passed
    '--port': Number, // --port <number> or --port=<number>

    // Aliases
    '-h': '--help',
    '-v': '--version',
    '-p': '--port',
});

if (args['--version']) return console.log('0.0.1');
if (args['--help']) return console.log('Figure it out');

const server = startServer(args['--port']);
