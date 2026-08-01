// Environment-allowlist fixture: the input symbol names an environment
// variable; the output reports "present" or null without echoing the value.
'use strict';
const readline = require('node:readline');

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'reset') {
    send({ type: 'ready', requestId: message.requestId });
  } else if (message.type === 'input') {
    const present = process.env[message.symbol] !== undefined;
    send({ type: 'output', requestId: message.requestId, symbol: present ? 'present' : null });
  } else if (message.type === 'close') {
    send({ type: 'closed', requestId: message.requestId });
    process.exit(0);
  }
});
