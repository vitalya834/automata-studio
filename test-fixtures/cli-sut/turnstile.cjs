// Happy-path fixture: deterministic Mealy turnstile over the JSON Lines protocol.
'use strict';
const readline = require('node:readline');

const TABLE = {
  'locked coin': ['unlocked', 'unlock'],
  'locked push': ['locked', 'none'],
  'unlocked push': ['locked', 'lock'],
  'unlocked coin': ['unlocked', 'none'],
};

let state = 'locked';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'reset') {
    state = 'locked';
    send({ type: 'ready', requestId: message.requestId });
  } else if (message.type === 'input') {
    const entry = TABLE[state + ' ' + message.symbol];
    const [next, output] = entry;
    const from = state;
    state = next;
    send({ type: 'output', requestId: message.requestId, symbol: output, metadata: { from, to: next } });
  } else if (message.type === 'close') {
    send({ type: 'closed', requestId: message.requestId });
    process.exit(0);
  }
});
