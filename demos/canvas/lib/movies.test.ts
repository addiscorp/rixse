import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capped, series } from './movies.ts';

const films = [
  { title: 'A', year: 2019, gross: 100 }, { title: 'B', year: 2019, gross: 50 },
  { title: 'C', year: 2020, gross: 70 }, { title: 'D', year: 2021, gross: 10 },
];

test('rows with the same label become one bar, summed', () => {
  assert.deepEqual(series(films, { label: 'year', value: 'gross', sort: 'label asc', limit: 0 }), [
    { label: '2019', value: 150 }, { label: '2020', value: 70 }, { label: '2021', value: 10 },
  ]);
});

test('avg groups average instead of summing; sort and limit apply after grouping', () => {
  assert.deepEqual(series(films, { label: 'year', value: 'avg(gross)', sort: 'value desc', limit: 1 }), [{ label: '2019', value: 75 }]);
});

test('nested aggregates: sum and count over a relationship', () => {
  const genres = [{ name: 'x', movies: [{ gross: 5 }, { gross: 7 }] }, { name: 'y', movies: [{ gross: 1 }] }];
  assert.deepEqual(series(genres, { label: 'name', value: 'sum(movies.gross)', sort: '', limit: 0 }), [{ label: 'x', value: 12 }, { label: 'y', value: 1 }]);
  assert.deepEqual(series(genres, { label: 'name', value: 'count(movies)', sort: '', limit: 0 }), [{ label: 'x', value: 2 }, { label: 'y', value: 1 }]);
});

test('a chart never draws more than its cap; a pie folds the rest into Other', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ label: `p${i}`, value: 1000 - i }));
  assert.equal(capped(many, 'bar').data.length, 30);
  assert.equal(capped(many, 'bar').hidden, 970);
  const pie = capped(many, 'pie');
  assert.equal(pie.data.length, 8);
  assert.equal(pie.data.at(-1)!.label, 'Other (993)');
  assert.equal(pie.data.reduce((a, d) => a + d.value, 0), many.reduce((a, d) => a + d.value, 0), 'Other keeps the total');
});

import { place } from './movies.ts';

test('placement: end, before, after, replace — decided by the agent, checked by rixse', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(place(order, 'n').order, ['a', 'b', 'c', 'n']);
  assert.deepEqual(place(order, 'n', 'before', 'b').order, ['a', 'n', 'b', 'c']);
  assert.deepEqual(place(order, 'n', 'after', 'b').order, ['a', 'b', 'n', 'c']);
  assert.deepEqual(place(order, 'n', 'replace', 'b'), { order: ['a', 'n', 'c'], removed: 'b' });
  assert.deepEqual(place(order, 'a', 'after', 'c').order, ['b', 'c', 'a'], 'moving an existing view');
  assert.throws(() => place(order, 'n', 'replace', 'zz'), /no view "zz"/);
  assert.throws(() => place(order, 'b', 'before', 'b'), /relative to itself/);
  assert.throws(() => place(order, 'n', 'after'), /needs a target/);
});

import { hintFor } from './movies.ts';

test('zega errors become exact corrections from the schema', () => {
  const schema = 'schema {\n  type Movie {\n    title: String\n    genres: TAGGED -> Genre[]\n  }\n  type Person {\n    acted_in: CAST <- Movie[]\n  }\n}';
  assert.equal(hintFor('error: Movie.genres does not reach name', schema), ' Fix: follow it with its arrow, type and braces — write `genres -> Genre { name }`.');
  assert.equal(hintFor('error: Person.acted_in does not point ->', schema), ' Fix: write `acted_in <- …`.');
  assert.equal(hintFor('error: something else', schema), '');
});

import { statOf } from './movies.ts';

test('stat: one number; caption is the one real name, else the view title', () => {
  assert.deepEqual(statOf([{ title: 'Titanic', gross: 5 }], { label: 'title', value: 'gross', title: 'Box office' }), { value: 5, caption: 'Titanic' });
  assert.deepEqual(statOf([{ gross: 5 }], { label: 'gross', value: 'gross', title: 'Box office' }), { value: 5, caption: 'Box office' }, 'a number is not a caption');
  assert.deepEqual(statOf([{ name: 'x', movies: [{}, {}, {}] }], { label: 'name', value: 'count(movies)', title: 'Films' }), { value: 3, caption: 'x' });
  assert.equal(statOf([{ title: 'a' }], { label: 'title', value: 'gross', title: 't' }), null);
});

import { lineData } from './movies.ts';

test('line: nested rows become series by year; gaps are joined, not zeroed; drops compare real points', () => {
  const rows = [
    { name: 'superhero', movies: [{ year: 2018, gross: 60 }, { year: 2018, gross: 8 }, { year: 2019, gross: 51 }, { year: 2021, gross: 28 }, { year: 2023, gross: 8 }] },
    { name: 'drama', movies: [{ year: 2019, gross: 5 }] },
  ];
  const d = lineData(rows, { label: 'name', x: 'movies.year', value: 'sum(movies.gross)', flag: 'drops', threshold: 25, limit: 0 });
  assert.deepEqual(d.xs, [2018, 2019, 2020, 2021, 2022, 2023]);
  assert.deepEqual(d.series[0], { name: 'superhero', points: [{ x: 2018, y: 68 }, { x: 2019, y: 51 }, { x: 2021, y: 28 }, { x: 2023, y: 8 }] });
  // the two biggest drops between real points: 2021→2023 (−71%) and 2019→2021 (−45%); no fake −100% into empty years
  assert.deepEqual(d.flags.filter((f) => f.series === 'superhero').map((f) => [f.x, f.pct]), [[2023, -71], [2021, -45]]);
  assert.equal(lineData(rows, { label: 'name', x: 'movies.year', value: 'sum(movies.gross)', flag: 'none', threshold: 0, limit: 0 }).flags.length, 0);
});
