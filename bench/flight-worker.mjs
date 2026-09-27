import { renderToReadableStream } from 'react-server-dom-webpack/server.node';
import { canvasTree } from './tree.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const state = JSON.parse(input);
const stream = await renderToReadableStream(canvasTree(state), {});
let payload = '';
for await (const chunk of stream) payload += Buffer.from(chunk).toString('utf8');
process.stdout.write(payload);
