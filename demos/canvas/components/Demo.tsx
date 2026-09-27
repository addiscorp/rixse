'use client';
// Owns the one store. Chat, Canvas and Logs only read it and dispatch into it.
import { useMemo, useState } from 'react';
import { nextOrder } from 'rixse-react';
import { createCanvasStore, createCanvasWire } from '@/lib/canvas';
import { Chat } from './Chat';
import { Canvas } from './Canvas';
import { Logs, type Note } from './Logs';

export function Demo() {
  const store = useMemo(() => createCanvasStore(), []);
  // One wire per session: handles stay stable across turns.
  const wire = useMemo(() => createCanvasWire(), []);
  const [notes, setNotes] = useState<Note[]>([]);
  const note = (n: Omit<Note, 'at' | 'order'>) => { const stamp = { at: Date.now(), order: nextOrder() }; setNotes((list) => [...list.slice(-199), { ...n, ...stamp }]); };
  return (
    <div className="app">
      <header className="bar">
        <span className="mark"><span className="dots" aria-hidden="true"><i /><i /></span>rixse</span>
        <span className="soft">canvas demo</span>
      </header>
      <Chat store={store} wire={wire} note={note} />
      <Canvas store={store} />
      <Logs store={store} notes={notes} />
    </div>
  );
}
