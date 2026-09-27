import { createCanvasStore, type CanvasState, type CanvasStore } from '../demos/canvas/lib/canvas.ts';

export type BenchTask = {
  id: string;
  setup: (store: CanvasStore) => void;
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  rejections?: string[];
  check: (state: CanvasState, initial: CanvasState, result: { proposed: number; accepted: number }) => boolean;
};

const add = (store: CanvasStore, id: string, title: string, x = 40, y = 40, body = '', tone: 'plain' | 'accent' | 'good' | 'warn' = 'plain') => {
  const r = store.dispatch({ type: 'card.add', payload: { id, title, x, y, body, tone } }, 'you');
  if (!r.ok) throw new Error(`task fixture add ${id}: ${r.error}`);
};
const setup = (cards: [string, string, number?, number?, string?, ('plain' | 'accent' | 'good' | 'warn')?][], links: [string, string, string?][] = []) => (store: CanvasStore) => {
  for (const [id, title, x, y, body, tone] of cards) add(store, id, title, x, y, body, tone);
  for (const [from, to, label] of links) {
    const r = store.dispatch({ type: 'link.add', payload: { from, to, label } }, 'you');
    if (!r.ok) throw new Error(`task fixture link: ${r.error}`);
  }
};
const same = (a: CanvasState, b: CanvasState) => JSON.stringify(a) === JSON.stringify(b);
const task = (id: string, message: string, init: ReturnType<typeof setup>, check: BenchTask['check'], extra: Partial<BenchTask> = {}): BenchTask => ({ id, message, setup: init, check, ...extra });

export const tasks: BenchTask[] = [
  task('funnel', 'Create a three-step funnel for Visit, Signup, and Purchase, with arrows between consecutive steps.', setup([]), (s) => Object.values(s.cards).some((c) => /visit/i.test(c.title)) && Object.values(s.cards).some((c) => /signup/i.test(c.title)) && Object.values(s.cards).some((c) => /purchase/i.test(c.title)) && s.links.length >= 2),
  task('title', 'Rename the Checkout card to Payment.', setup([['checkout', 'Checkout']]), (s) => s.cards.checkout?.title === 'Payment'),
  task('risky', 'Mark the risky steps warn.', setup([['payment', 'Payment', 40, 40, 'collect card details'], ['email', 'Email verification', 300, 40], ['confirm', 'Confirmation', 580, 40]]), (s) => s.cards.payment?.tone === 'warn' && s.cards.email?.tone === 'warn'),
  task('column', 'Put the three steps in a column, one below another.', setup([['one', 'Discover', 10, 20], ['two', 'Evaluate', 300, 150], ['three', 'Buy', 600, 300]]), (s) => s.cards.one?.x === s.cards.two?.x && s.cards.two?.x === s.cards.three?.x && s.cards.one.y < s.cards.two.y && s.cards.two.y < s.cards.three.y),
  task('link-meaning', 'Connect the Signup step to the Welcome email step and label the arrow "starts onboarding".', setup([['signup', 'Signup'], ['welcome', 'Welcome email']]), (s) => s.links.some((l) => l.from === 'signup' && l.to === 'welcome' && /onboarding/i.test(l.label))),
  task('remove-meaning', 'Remove the obsolete Deprecated API card.', setup([['api', 'Deprecated API'], ['stable', 'Stable API']]), (s) => !s.cards.api && s.cards.stable),
  task('follow-up', 'Move that same report card to the right side of the board.', setup([['report', 'Weekly report', 50, 100]]), (s) => s.cards.report?.x >= 700, { history: [{ role: 'user', content: 'Add a weekly report card.' }, { role: 'assistant', content: 'Added the weekly report card.' }] }),
  task('sixty-card', 'Change the title of the card named Checkpoint 42 to Verified checkpoint 42.', setup(Array.from({ length: 60 }, (_, i) => [`c${i}`, `Checkpoint ${i}`, (i % 4) * 270, Math.floor(i / 4) * 40] as [string, string, number, number])), (s) => s.cards.c42?.title === 'Verified checkpoint 42'),
  task('noop-checkout', 'Is there a checkout card?', setup([['checkout', 'Checkout']]), (s, initial, r) => r.proposed === 0 && same(s, initial)),
  task('create-note', 'Add a card titled Launch checklist with body "Confirm owner and date".', setup([]), (s) => Object.values(s.cards).some((c) => c.title === 'Launch checklist' && /owner/.test(c.body))),
  task('update-body', 'Add the body "Review with legal" to the Privacy review card.', setup([['privacy', 'Privacy review']]), (s) => /Review with legal/.test(s.cards.privacy?.body ?? '')),
  task('good-tone', 'Mark the completed Migration step as good.', setup([['migration', 'Migration', 40, 40, '', 'accent']]), (s) => s.cards.migration?.tone === 'good'),
  task('move-specific', 'Move the Alert card to x=700 and y=240.', setup([['alert', 'Alert']]), (s) => s.cards.alert?.x === 700 && s.cards.alert?.y === 240),
  task('link-existing-nodes', 'Add an arrow from Intake to Triage.', setup([['intake', 'Intake'], ['triage', 'Triage']]), (s) => s.links.some((l) => l.from === 'intake' && l.to === 'triage')),
  task('remove-link', 'Remove the arrow from Draft to Published.', setup([['draft', 'Draft'], ['published', 'Published']], [['draft', 'published', 'publish']]), (s) => !s.links.some((l) => l.from === 'draft' && l.to === 'published')),
  task('rename-risk', 'Change "Risk review" to "Security review" and keep its warning tone.', setup([['risk', 'Risk review', 50, 50, '', 'warn']]), (s) => s.cards.risk?.title === 'Security review' && s.cards.risk.tone === 'warn'),
  task('noop-noon', 'Thanks, that is helpful.', setup([['status', 'Status']]), (s, initial, r) => r.proposed === 0 && same(s, initial)),
  task('recover-unknown-card', 'Now update the actual card title to Payment.', setup([['checkout', 'Checkout']]), (s) => s.cards.checkout?.title === 'Payment', { rejections: ['no card "check-out"'] }),
  task('recover-duplicate-link', 'The link already exists; do not add it again. Set its label to "verified" if possible.', setup([['a', 'Start'], ['b', 'Finish']], [['a', 'b', 'old']]), (s) => s.links.length === 1, { rejections: ['link a → b exists'] }),
  task('recover-invalid-tone', 'Use the supported warn tone for the Risk gate.', setup([['risk', 'Risk gate']]), (s) => s.cards.risk?.tone === 'warn', { rejections: ['"tone" must be one of plain, accent, good, warn'] }),
];

export function makeTaskState(item: BenchTask) {
  const store = createCanvasStore();
  item.setup(store);
  return { store, initial: structuredClone(store.state) };
}
