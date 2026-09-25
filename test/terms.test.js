import test from 'node:test';
import assert from 'node:assert/strict';
import { topTerms, distinctiveTerms, nameTokens, termsOfText } from '../public/lib/terms.js';

test('generic praise/filler words in any language are not "insights"', () => {
  const words = termsOfText('Super app, muito bom, buena, excelente, супер, nice and easy, çok güzel harika');
  assert.deepEqual([...words], []);
});

test('app-name words are excluded', () => {
  const exclude = nameTokens('Body Tune - Face Photo Editor');
  assert.deepEqual([...termsOfText('body tune crashes on export', exclude)].sort(), ['crashes', 'export']);
});

test('distinctive terms separate complaints from praise', () => {
  const low = [
    { rating: 1, text: 'crashes when I export' }, { rating: 1, text: 'subscription charged twice' },
    { rating: 2, text: 'crashes after update, subscription scam' }, { rating: 1, text: 'filters crashes' },
  ];
  const high = [
    { rating: 5, text: 'filters look natural' }, { rating: 5, text: 'natural filters, smooth editing' },
    { rating: 4, text: 'smooth and natural' },
  ];
  const complaints = distinctiveTerms(low, high).map((t) => t.term);
  const praise = distinctiveTerms(high, low).map((t) => t.term);
  assert.equal(complaints[0], 'crashes');
  assert.ok(complaints.includes('subscription'));
  assert.ok(!complaints.includes('filters'), 'a word common in both groups is not a complaint');
  assert.ok(praise.includes('natural'));
  assert.ok(!praise.includes('crashes'));
});

test('topTerms counts a review once per term', () => {
  const [first] = topTerms([{ text: 'lag lag lag' }, { text: 'lag again' }]);
  assert.deepEqual(first, { term: 'lag', count: 2 });
});

test('connector words in other languages are not reported as complaint terms', () => {
  const bad = [
    { rating: 1, text: 'Perdi minha sequência depois da atualização' },
    { rating: 1, text: 'La sincronización falla después de actualizar, entre dispositivos' },
  ];
  const good = ['Widget lindo', 'Diseño limpio', 'Recordatorios puntuales', 'Estatísticas claras', 'Calendário ótimo'].map((text) => ({ rating: 5, text }));
  const terms = distinctiveTerms(bad, good).map((t) => t.term);
  for (const w of ['depois', 'después', 'entre']) assert.ok(!terms.includes(w), `${w} is filler`);
  assert.ok(terms.includes('sincronización'));
});
