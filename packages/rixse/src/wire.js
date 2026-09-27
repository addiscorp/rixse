// Draft rixse wire v0 for compact canvas state and line-oriented proposals.
const quote = (value) => JSON.stringify(String(value));
function tokenize(line) {
  const parts = [];
  const re = /\s*((?:"(?:\\.|[^"\\])*"|[^\s"])+)/gy;
  let at = 0;
  while (at < line.length) {
    re.lastIndex = at;
    const match = re.exec(line);
    if (!match) throw new Error(`invalid token at column ${at + 1}`);
    const raw = match[1];
    parts.push(raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw.replace(/"(?:\\.|[^"\\])*"/g, (quoted) => JSON.parse(quoted)));
    at = re.lastIndex;
  }
  return parts;
}

function stateHandles(state, context) {
  for (const id of Object.keys(state.cards)) {
    if (!context.idToHandle.has(id)) {
      let handle;
      do { handle = `c${context.next++}`; } while (context.handleToId.has(handle));
      context.idToHandle.set(id, handle);
      context.handleToId.set(handle, id);
    }
  }
  return context;
}

export function createWireContext(state = { cards: {}, links: [] }) {
  const context = { idToHandle: new Map(), handleToId: new Map(), next: 1 };
  return stateHandles(state, context);
}

export function encodeWireState(state, context = createWireContext(state)) {
  stateHandles(state, context);
  const lines = ['card(h title tone x,y body)'];
  for (const card of Object.values(state.cards)) {
    const row = [context.idToHandle.get(card.id), quote(card.title)];
    if (card.tone !== 'plain') row.push(card.tone);
    row.push(`${card.x},${card.y}`);
    if (card.body) row.push(quote(card.body));
    lines.push(row.join(' '));
  }
  lines.push('link(from to label)');
  for (const link of state.links) {
    const row = [context.idToHandle.get(link.from), context.idToHandle.get(link.to)];
    if (link.label) row.push(quote(link.label));
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

export function decodeWireState(wire, context = createWireContext()) {
  const cards = {};
  const links = [];
  let section = '';
  for (const [index, raw] of wire.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'card(h title tone x,y body)') { section = 'card'; continue; }
    if (line === 'link(from to label)') { section = 'link'; continue; }
    const values = tokenize(line);
    if (section === 'card') {
      if (values.length < 3) throw new Error(`line ${index + 1}: incomplete card row`);
      const [handle, title] = values;
      const hasTone = ['plain', 'accent', 'good', 'warn'].includes(values[2]);
      const tone = hasTone ? values[2] : 'plain';
      const point = values[hasTone ? 3 : 2];
      const body = values[hasTone ? 4 : 3] ?? '';
      const xy = /^(-?\d+),(-?\d+)$/.exec(point ?? '');
      if (!xy) throw new Error(`line ${index + 1}: invalid position`);
      const id = context.handleToId.get(handle) ?? handle;
      cards[id] = { id, title, tone, x: Number(xy[1]), y: Number(xy[2]), body };
    } else if (section === 'link') {
      if (values.length < 2 || values.length > 3) throw new Error(`line ${index + 1}: invalid link row`);
      const [from, to, label = ''] = values;
      links.push({ from: context.handleToId.get(from) ?? from, to: context.handleToId.get(to) ?? to, label });
    } else throw new Error(`line ${index + 1}: row before schema`);
  }
  return { cards, links };
}

function resolveHandle(handle, context) {
  if (!/^c\d+$/.test(handle) || !context.handleToId.has(handle)) throw new Error(`unknown handle ${handle}`);
  return context.handleToId.get(handle);
}

function readCardValues(words, context, lineNo) {
  if (words.length < 1) throw new Error('card op requires a title');
  const title = words[0];
  let i = 1;
  let tone;
  if (['plain', 'accent', 'good', 'warn'].includes(words[i])) tone = words[i++];
  const position = /^(-?\d+),(-?\d+)$/.exec(words[i] ?? '');
  if (!position) throw new Error(`line ${lineNo}: expected x,y position`);
  i++;
  const body = words.slice(i).join(' ');
  return { title, ...(tone ? { tone } : {}), x: Number(position[1]), y: Number(position[2]), ...(body ? { body } : {}) };
}

/** Parse wire v0 operations to canvas actions; invalid lines are counted with their reason. */
export function parseWireOps(text, context) {
  const actions = [];
  const rejected = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('say:')) continue;
    const no = index + 1;
    try {
      if (line === 'clear') actions.push({ type: 'canvas.clear', payload: {} });
      else if (line.startsWith('+')) {
        const words = tokenize(line.slice(1));
        const handle = words.shift();
        if (!/^c\d+$/.test(handle ?? '') || context.handleToId.has(handle)) throw new Error(`invalid or existing handle ${handle}`);
        if (words.shift() !== 'card') throw new Error('card.add requires the card keyword');
        const values = readCardValues(words, context, no);
        const id = `wire-${handle}`;
        context.handleToId.set(handle, id); context.idToHandle.set(id, handle);
        actions.push({ type: 'card.add', payload: { id, ...values } });
      } else if (line.startsWith('~')) {
        const words = tokenize(line.slice(1));
        const id = resolveHandle(words.shift(), context);
        const payload = { id };
        for (const field of words) {
          const at = field.indexOf('=');
          if (at < 1) throw new Error(`invalid update field ${field}`);
          const key = field.slice(0, at), value = field.slice(at + 1);
          if (!['title', 'body', 'tone'].includes(key)) throw new Error(`unknown update field ${key}`);
          payload[key] = value;
        }
        actions.push({ type: 'card.update', payload });
      } else if (line.startsWith('>')) {
        const words = tokenize(line.slice(1));
        const id = resolveHandle(words[0], context), xy = /^(-?\d+),(-?\d+)$/.exec(words[1] ?? '');
        if (!xy || words.length !== 2) throw new Error('move requires handle and x,y');
        actions.push({ type: 'card.move', payload: { id, x: Number(xy[1]), y: Number(xy[2]) } });
      } else if (line.startsWith('-')) {
        const words = tokenize(line.slice(1));
        if (words.length !== 1) throw new Error('card.remove requires one handle');
        actions.push({ type: 'card.remove', payload: { id: resolveHandle(words[0], context) } });
      }
      else if (line.startsWith('=' ) || line.startsWith('!')) {
        const op = line[0], words = tokenize(line.slice(1));
        const from = resolveHandle(words[0], context), to = resolveHandle(words[1], context);
        if (op === '=' && (words.length < 2 || words.length > 3)) throw new Error('link.add requires two handles and optional label');
        if (op === '!' && words.length !== 2) throw new Error('link.remove requires two handles');
        actions.push({ type: op === '=' ? 'link.add' : 'link.remove', payload: { from, to, ...(op === '=' && words[2] ? { label: words[2] } : {}) } });
      } else throw new Error(`unknown operation ${line.split(/\s/, 1)[0]}`);
    } catch (error) { rejected.push({ line, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return { say: text.match(/(?:^|\n)say:\s*(.*)/)?.[1] ?? '', actions, rejected };
}
