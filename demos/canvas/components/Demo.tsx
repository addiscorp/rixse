'use client';
// Owns the stores. Two vocabularies over the same rixse core: a free canvas of
// cards, and an app screen (a node tree rendered with shadcn/ui).
import { useEffect, useMemo, useState } from 'react';
import { nextOrder } from 'rixse-react';
import { CANVAS_BRIEF, createCanvasStore, createCanvasWire } from '@/lib/canvas';
import { UI_BRIEF, createUiStore, createUiWire } from '@/lib/ui';
import { createMoviesStore, createMoviesWire, moviesBrief } from '@/lib/movies';
import { loadZega } from '@/lib/zega';
import { MoviesView } from './MoviesView';
import { Chat } from './Chat';
import { Canvas } from './Canvas';
import { UiView } from './UiView';
import { Logs, type Note } from './Logs';

type Mode = 'movies' | 'ui' | 'canvas';

export function Demo() {
  const canvas = useMemo(() => ({ store: createCanvasStore(), wire: createCanvasWire() }), []);
  const ui = useMemo(() => ({ store: createUiStore(), wire: createUiWire() }), []);
  const movies = useMemo(() => ({ store: createMoviesStore(), wire: createMoviesWire() }), []);
  // The schema goes to the model; it is read from zega once the engine has loaded.
  const [mBrief, setMBrief] = useState(moviesBrief('(loading)'));
  useEffect(() => { loadZega().then((z) => setMBrief(moviesBrief(z.schema))).catch(() => {}); }, []);
  const [mode, setMode] = useState<Mode>('movies');
  const [notes, setNotes] = useState<Record<Mode, Note[]>>({ movies: [], ui: [], canvas: [] });
  const note = (m: Mode) => (n: Omit<Note, 'at' | 'order'>) => { const stamp = { at: Date.now(), order: nextOrder() }; setNotes((all) => ({ ...all, [m]: [...all[m].slice(-199), { ...n, ...stamp }] })); };
  return (
    <div className="app">
      <header className="bar">
        <span className="mark"><span className="dots" aria-hidden="true"><i /><i /></span>rixse</span>
        <div className="seg" role="group" aria-label="Vocabulary">
          <button type="button" aria-pressed={mode === 'movies'} onClick={() => setMode('movies')}>Movies · zega</button>
          <button type="button" aria-pressed={mode === 'ui'} onClick={() => setMode('ui')}>UI · shadcn</button>
          <button type="button" aria-pressed={mode === 'canvas'} onClick={() => setMode('canvas')}>Canvas · cards</button>
        </div>
        <span className="soft">same core, different vocabulary</span>
      </header>
      <div className="mode" hidden={mode !== 'movies'}>
        <Chat store={movies.store} wire={movies.wire} brief={mBrief} note={note('movies')}
          describe={(s) => `${s.order.length} views`}
          hint="Ask about the 250 highest-grossing films, e.g. “top 10 movies by box office”, “box office by genre”, “movies Tom Hanks and Meg Ryan are both in”." />
        <MoviesView store={movies.store} />
        <Logs store={movies.store} notes={notes.movies} />
      </div>
      <div className="mode" hidden={mode !== 'ui'}>
        <Chat store={ui.store} wire={ui.wire} brief={UI_BRIEF} note={note('ui')}
          describe={(s) => `${Object.keys(s.nodes).length - 1} nodes`}
          hint="Ask for a screen, e.g. “a store product page with a cart icon in the top right”, then change it: “make the price bigger”, “add reviews under the description”." />
        <UiView store={ui.store} />
        <Logs store={ui.store} notes={notes.ui} />
      </div>
      <div className="mode" hidden={mode !== 'canvas'}>
        <Chat store={canvas.store} wire={canvas.wire} brief={CANVAS_BRIEF} note={note('canvas')}
          describe={(s) => `${Object.keys(s.cards).length} cards`}
          hint="Ask for something on the canvas, e.g. “sketch a signup funnel with 4 steps and mark where people drop”." />
        <Canvas store={canvas.store} />
        <Logs store={canvas.store} notes={notes.canvas} />
      </div>
    </div>
  );
}
