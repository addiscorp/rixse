// A deterministic walkthrough, not a live agent. No network calls are made here.
(() => {
  const $ = id => document.getElementById(id);
  const stages = [
    { title: 'The page loads. The model doesn’t.', description: 'Starting with a configured top-10 view, the source returns rows and view(state) renders locally—zero model requests.', nodes: ['source', 'state', 'view', 'page'], edges: ['query', 'rows', 'state', 'render'], terms: ['view'], focus: 'chart' },
    { title: 'Use it like any other app.', description: 'Select Avatar and Titanic, hover a bar, or filter a view: ordinary interaction updates local state and re-renders, without calling a model.', nodes: ['user', 'state', 'view', 'page'], edges: ['use', 'actions', 'state', 'render'], terms: ['view'], focus: 'selection' },
    { title: 'You ask. The agent joins.', description: '“compare these over the years” starts one request—only because you explicitly asked for an agent turn.', nodes: ['user', 'model'], edges: ['prompt'], terms: ['prompt', 'agent'], focus: 'ask' },
    { title: 'A description leaves. The rows stay.', description: 'The model gets the schema, a compact view(state), selected names and your prompt; inspect the actual request below.', nodes: ['source', 'state', 'page', 'model'], edges: ['summary', 'prompt'], terms: ['schema', 'view', 'prompt'], focus: 'selection' },
    { title: 'An action comes back.', description: 'The model proposes view.show with a line-chart kind, a query and typed parameters; it does not draw pixels or write executable UI code.', nodes: ['model', 'state'], edges: ['reply'], terms: ['agent'], focus: 'proposal' },
    { title: 'Your app draws the result.', description: 'The app validates and runs the query locally, applies the state change, and view(state) renders a line chart with the two real observations.', nodes: ['source', 'state', 'view', 'page'], edges: ['query', 'rows', 'state', 'render'], terms: ['view', 'ui'], focus: 'chart' },
  ];
  let current = 1;
  function show(stage, interacted = true) {
    current = Math.max(1, Math.min(6, stage));
    const s = stages[current - 1];
    $('explainer').dataset.stage = current;
    $('step-number').textContent = `${String(current).padStart(2, '0')} / 06`;
    $('stage-title').textContent = s.title;
    $('stage-description').textContent = s.description;
    $('back').disabled = current === 1;
    $('next').disabled = current === 6;
    document.querySelectorAll('[data-step]').forEach(el => {
      if (Number(el.dataset.step) === current) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.node').forEach(el => el.classList.toggle('active', s.nodes.includes(el.id.slice(5))));
    document.querySelectorAll('.edge').forEach(el => el.classList.toggle('active', s.edges.includes(el.id.slice(5))));
    document.querySelectorAll('[data-term]').forEach(el => el.classList.toggle('lit', s.terms.includes(el.dataset.term)));
    const selected = current >= 2 && current <= 5;
    document.querySelectorAll('.bar-row').forEach(el => {
      const on = selected && ['Avatar', 'Titanic'].includes(el.dataset.name);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-pressed', String(on));
    });
    $('filter').hidden = current !== 2;
    $('filter').setAttribute('aria-pressed', 'false');
    document.querySelectorAll('.bar-row').forEach(el => { el.hidden = false; });
    $('chart').classList.toggle('focus', s.focus === 'chart');
    $('selection').classList.toggle('active', selected);
    $('selection').textContent = selected ? 'Selected: Avatar + Titanic · 2 bars' : current === 6 ? 'Query complete · 2 rows · rendered locally' : 'Click a bar to select it. Hover to see its value.';
    $('ask').classList.toggle('focus', s.focus === 'ask');
    $('ask-text').textContent = current >= 3 ? 'compare these over the years' : 'Ask about these movies…';
    $('bars').hidden = current === 6;
    $('line').hidden = current !== 6;
    $('chart-title').textContent = current === 6 ? 'Box office by release year' : 'Top 10 · worldwide box office';
    $('chart-kind').textContent = current === 6 ? 'line / large' : 'bar / large';
    $('proposal').hidden = current !== 5;
    $('payload').hidden = current !== 4;
    $('response').hidden = current !== 5;
    $('model-count').textContent = current >= 3 ? '1' : '0';
    $('network').classList.toggle('requested', current >= 3);
    $('network-status').textContent = current >= 3 ? 'ONE EXPLICIT ASK' : 'LOCAL ONLY';
    $('request-log').hidden = current < 3;
    $('request-status').textContent = current >= 5 ? 'completed' : 'sent once';
    $('source-log').textContent = current === 6 ? 'source.run → 2 rows' : 'source.run → 10 rows';
    $('flow-status').textContent = current <= 2 ? 'Model connection inactive · nothing sent' : current === 6 ? 'Back on-device · no additional model request' : current === 5 ? 'Model → app · typed action' : 'App → model · one explicit request';
    if (interacted) document.querySelector('.stage-index').open = current === 1;
  }
  $('back').addEventListener('click', () => show(current - 1));
  $('next').addEventListener('click', () => show(current + 1));
  document.querySelectorAll('[data-step]').forEach(el => el.addEventListener('click', () => show(Number(el.dataset.step))));
  $('filter').addEventListener('click', () => {
    const filtered = $('filter').getAttribute('aria-pressed') !== 'true';
    $('filter').setAttribute('aria-pressed', String(filtered));
    document.querySelectorAll('.bar-row').forEach(el => { el.hidden = filtered && !el.classList.contains('selected'); });
  });
  $('ask-button').addEventListener('click', () => show(3));
  document.querySelectorAll('.bar-row').forEach(el => el.addEventListener('click', () => {
    if (current !== 2) show(2);
    else {
      el.classList.toggle('selected');
      el.setAttribute('aria-pressed', String(el.classList.contains('selected')));
      const names = [...document.querySelectorAll('.bar-row.selected')].map(row => row.dataset.name);
      $('selection').textContent = names.length ? `Selected: ${names.join(' + ')}` : 'No bars selected';
    }
  }));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      show(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  $('theme').addEventListener('change', event => {
    document.documentElement.dataset.theme = event.target.value;
  });
  document.documentElement.classList.add('js');
  show(1, false);
})();
