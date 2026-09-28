// The Movies demo with no framework: plain DOM, the rixse package straight
// from /packages, the shared movies vocabulary (same catalogue, zega source
// and brief as the canvas demo) and the same agent route contract. The agent
// endpoint is configurable: ?agent=<url> (default: the canvas demo's dev
// server at http://localhost:3100/api/agent).
import { createMoviesStore, createMoviesWire, moviesBrief } from 'rixse-demo-shared/movies';
import { loadZega } from 'rixse-demo-shared/zega';
import { streamAgent } from 'rixse-demo-shared/agent';
import { renderScreen } from './views.js';

const store = createMoviesStore();
const wire = createMoviesWire();

const params = new URLSearchParams(location.search);
const AGENT_ENDPOINT = params.get('agent') ?? 'http://localhost:3100/api/agent';

const statusEl = document.getElementById('status');
const screenEl = document.getElementById('screen');
const turnsEl = document.getElementById('turns');
const form = document.getElementById('composer');
const input = document.getElementById('chat-input');
const sendButton = document.getElementById('send');
document.getElementById('agent-endpoint').textContent = `agent: POST ${AGENT_ENDPOINT}`;

let brief = moviesBrief('(loading)');
let rejections = [];
let width = 0;
const turns = [];

const render = () => renderScreen(screenEl, store.state, store, width);
store.subscribe(render);
new ResizeObserver(([e]) => { width = e.contentRect.width; render(); }).observe(screenEl);
render();

loadZega().then((z) => {
  brief = moviesBrief(z.schema);
  const n = (q) => z.run(q).length.toLocaleString('en-US');
  statusEl.textContent = `zega loaded in ${z.loadMs} ms · ${n('{ Movie limit 100000 { qid } }')} movies · ${n('{ Person limit 100000 { qid } }')} people`;
  statusEl.dataset.ready = 'true';
}).catch((e) => { statusEl.textContent = `zega failed: ${e}`; });

function appendTurn(role, content) {
  if (turns.length === 0) turnsEl.textContent = '';
  const msg = document.createElement('div');
  msg.className = `msg ${role === 'user' ? 'you' : 'agent'}`;
  msg.textContent = content;
  turnsEl.append(msg);
  msg.scrollIntoView({ block: 'end' });
  return msg;
}

async function send(message) {
  appendTurn('user', message);
  turns.push({ role: 'user', content: message });
  const history = turns.slice(-8).map(({ role, content }) => ({ role, content }));
  const bubble = appendTurn('assistant', '…');
  let say = '';
  try {
    await streamAgent(AGENT_ENDPOINT, {
      brief, message, history,
      context: wire.encode(store.state),
      format: 'wire', legend: wire.legend(), model: 'gemma',
      vocabulary: store.vocabulary(), rejections,
    }, (ev) => {
      if (ev.kind === 'say' && ev.say) { say = ev.say; bubble.textContent = say; }
      else if (ev.kind === 'action' && ev.action) {
        // The model refers to items by wire handle; translate back to real ids before dispatch.
        const a = wire.resolve(ev.action, store.params(ev.action.type));
        store.dispatch(a, 'agent', { why: message });
      } else if (ev.kind === 'error') throw new Error(ev.error);
    });
    turns.push({ role: 'assistant', content: say || '(done)' });
    if (!say) bubble.textContent = '(done)';
  } catch (e) {
    bubble.textContent = `Couldn't reach the agent: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  sendButton.disabled = true;
  send(message);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});
