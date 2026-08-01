// Mismatched-requestId fixture: replies to input with a bogus requestId.
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
    send({ type: 'output', requestId: 'bogus-999', symbol: 'oops' });
  } else if (message.type === 'close') {
    send({ type: 'closed', requestId: message.requestId });
    process.exit(0);
  }
});
