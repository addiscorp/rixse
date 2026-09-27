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
