// Early-exit fixture: answers reset, then dies with code 7 on the first input
// after flooding stderr (used to verify stderr capture and truncation).
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
    process.stderr.write('boom: simulated crash\n');
    process.stderr.write('x'.repeat(40000) + '\n', () => {
      process.exit(7);
    });
  } else if (message.type === 'close') {
    send({ type: 'closed', requestId: message.requestId });
    process.exit(0);
  }
});
