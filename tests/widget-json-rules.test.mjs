import assert from 'node:assert/strict';
import {test} from 'node:test';
import {field, list, model, plain, row, setup, setupViewModels} from './helpers/widget-harness.mjs';

test('JSON rules: omitted fields retain authored values, zero/false/empty values still apply', () => {
  const x = setup();
  x.apply([{score: 0, visible: false, title: ''}]);
  const first = x.rows.instanceAt(0);
  assert.equal(first.number('score').value, 0); assert.equal(first.boolean('visible').value, false);
  assert.equal(first.string('title').value, ''); assert.equal(first.string('subtitle').value, 'subtitle');
});

test('JSON rules: numeric-looking text and unknown properties are never guessed into numbers', () => {
  const x = setup();
  const incoming = [{score: '12.5', title: '3.0', subtitle: '0012', extra: '2.5', _metadata: '007'}];
  const result = x.apply(incoming);
  assert.deepEqual(plain(result), [{score: 12.5, title: '3.0', subtitle: '0012', extra: '2.5', _metadata: '007'}]);
  assert.equal(x.rows.instanceAt(0).string('title').value, '3.0');
  assert.equal(incoming[0].score, '12.5');
});

test('JSON rules: strings accept scalar text, but null/objects/arrays preserve the previous value', () => {
  const x = setup();
  for (const [input, expected] of [[false, 'false'], [0, '0'], [12.5, '12.5'], ['0012', '0012']]) {
    x.apply([{title: input}]); assert.equal(x.rows.instanceAt(0).string('title').value, expected);
  }
  for (const input of [null, {}, [], Infinity]) {
    x.apply([{title: input}]); assert.equal(x.rows.instanceAt(0).string('title').value, '0012');
  }
  assert.equal(x.warnings.length, 4);
});

test('JSON rules: all supported boolean transports work without JavaScript truthiness', () => {
  const x = setup();
  for (const [input, expected] of [[true, true], [false, false], [1, true], [0, false], [' TRUE ', true], ['False', false], ['1', true], ['0', false]]) {
    x.apply([{visible: input}]); assert.equal(x.rows.instanceAt(0).boolean('visible').value, expected);
  }
  assert.equal(x.warnings.length, 0);
});

test('JSON rules: overflow and underflow obey finite-number conversion without partial parsing', () => {
  const x = setup();
  for (const [input, expected] of [['1e309', 0], ['-1e309', 0], ['1e-400', 0], ['+3.125e2', 312.5], ['12.5px', 0], ['12 5', 0]]) {
    const result = x.apply([{score: input}]);
    assert.equal(result[0].score, expected); assert.equal(x.rows.instanceAt(0).number('score').value, expected);
  }
});

test('JSON rules: leading underscore metadata and internal nested slots cannot write live values', () => {
  const nested = model('Nested', {size__: field('number', 24), score: field('number', 1)});
  const entry = model('Row', {_private: field('string', 'authored'), profile: {type: 'viewModel', instance: nested}}), x = setup([entry]);
  x.apply([{_private: 'attempted overwrite', profile: {size__: '0', score: '2.5'}}]);
  assert.equal(entry.string('_private').value, 'authored');
  assert.equal(nested.number('size__').value, 24); assert.equal(nested.number('score').value, 2.5);
});

test('JSON rules: rejected nested values report their exact path and keep good sibling fields', () => {
  const profile = model('Profile', {enabled: field('boolean', true), score: field('number', 1)});
  const entry = model('Row', {profile: {type: 'viewModel', instance: profile}, title: field('string', 'old')}), x = setup([entry]);
  x.apply([{profile: {enabled: 'invalid', score: '4.5'}, title: 'new'}]);
  assert.equal(profile.boolean('enabled').value, true); assert.equal(profile.number('score').value, 4.5);
  assert.equal(entry.string('title').value, 'new');
  assert.equal(x.warnings[0][1].properties[0].path, 'rows/0/profile/enabled');
  assert.equal(x.warnings[0][1].properties[0].expected, 'boolean');
});

test('JSON enums: names win over numeric indices; invalid and fractional options leave the current value', () => {
  const mode = {type: 'enumType', accessor: {value: '0', values: ['1', '0', 'Timer']}};
  const entry = model('Row', {mode}), x = setup([entry]);
  x.apply([{mode: '1'}]); assert.equal(mode.accessor.value, '1');
  x.apply([{mode: 2}]); assert.equal(mode.accessor.value, 'Timer');
  for (const value of [-1, 3, 0.5, '2x', null]) {
    x.apply([{mode: value}]); assert.equal(mode.accessor.value, 'Timer');
  }
  assert.equal(x.warnings.length, 5);
});

test('JSON wrappers: a declared array-valued row property must not be mistaken for an outer table wrapper', () => {
  const entry = model('Row', {children: {type: 'list', accessor: list([])}}), x = setup([entry], 'ParentRow');
  x.definitions.set('ParentRow', {properties: entry.properties});
  const payload = {children: []};
  assert.equal(x.apply(payload), payload); assert.equal(x.rows.length, 1);
  assert.equal(x.rows.instanceAt(0), entry); assert.equal(x.rows.removed, 0);
});

test('lists: writes keep logical row identity even if a Rive sort reorders the list mid-update', () => {
  const a = row({id: 'a'}), b = row({id: 'b'}), x = setup([a, b]);
  const number = a.number('score'); let value = number.value;
  Object.defineProperty(number, 'value', {get: () => value, set(next) {value = next; x.rows.swap(0, 1);}});
  x.apply([{id: 'a', score: 9, title: 'A'}, {id: 'b', score: 3, title: 'B'}]);
  assert.equal(a.string('title').value, 'A'); assert.equal(a.number('score').value, 9);
  assert.equal(b.string('title').value, 'B'); assert.equal(b.number('score').value, 3);
});

test('lists: deleting a keyed row after a runtime sort removes the intended row', () => {
  const a = row({id: 'a'}), b = row({id: 'b'}), c = row({id: 'c'}), x = setup([a, b, c]);
  x.apply([{id: 'a'}, {id: 'b'}, {id: 'c'}]); x.rows.rows.reverse();
  x.apply([{id: 'a'}, {id: 'c'}]);
  assert.deepEqual(x.rows.rows, [a, c]); assert.equal(x.rows.rows.includes(b), false);
});

test('lists: duplicate row keys preserve row count and distinct instances', () => {
  const a = row({id: 'same'}), b = row({id: 'same'}), x = setup([a, b]);
  x.apply([{id: 'same', title: 'one'}, {id: 'same', title: 'two'}]);
  assert.equal(x.rows.length, 2); assert.notEqual(x.rows.instanceAt(0), x.rows.instanceAt(1));
  assert.equal(a.string('title').value, 'one'); assert.equal(b.string('title').value, 'two');
});

test('lists: name is the stable key when both name and ID are supplied', () => {
  const a = model('Row', {name: field('string', 'A'), id: field('string', 'same'), title: field('string', '')});
  const b = model('Row', {name: field('string', 'B'), id: field('string', 'same'), title: field('string', '')}), x = setup([a, b]);
  x.apply([{name: 'A', id: 'same'}, {name: 'B', id: 'same'}]);
  x.apply([{name: 'B', id: 'changed', title: 'second'}, {name: 'A', id: 'same', title: 'first'}]);
  assert.equal(x.rows.instanceAt(0), b); assert.equal(x.rows.instanceAt(1), a);
  assert.equal(b.string('title').value, 'second');
});

test('lists: failed model replacement retains the original row and identical JSON remains retryable', () => {
  const original = row(), x = setup([original]);
  x.definitions.set('Other', {defaultInstance: () => row({}, 'Other'), properties: original.properties});
  const payload = [{_vm: 'Other', title: 'new'}];
  x.rows.failAdd = true; x.apply(payload);
  assert.equal(x.rows.instanceAt(0), original); assert.equal(x.prop._lastListData, undefined);
  x.rows.failAdd = false; x.apply(payload);
  assert.equal(x.rows.length, 1); assert.equal(x.rows.instanceAt(0).viewModelName, 'Other');
  assert.equal(x.rows.instanceAt(0).string('title').value, 'new');
});

test('JSON controls: empty table wrapper clears rows and repeated payloads do not restart playback', async () => {
  const rows = list([row()]), x = setupViewModels(model('Main', {rows: {type: 'list', accessor: rows}}));
  await x.callbacks.onValue({rows: '{"arbitraryTableId":[]}'});
  assert.equal(rows.length, 0); assert.equal(x.plays.length, 1);
  await x.callbacks.onValue({rows: '{"arbitraryTableId":[]}'});
  assert.equal(x.plays.length, 1); assert.equal(x.publications.length, 0);
});

test('JSON rules: frozen caller data is accepted without mutation at any nested level', () => {
  const profile = model('Profile', {score: field('number', 1)}), x = setup([model('Row', {profile: {type: 'viewModel', instance: profile}})]);
  const payload = Object.freeze([Object.freeze({profile: Object.freeze({score: '12.5'})})]);
  const normalized = x.apply(payload);
  assert.equal(normalized[0].profile.score, 12.5); assert.equal(payload[0].profile.score, '12.5');
  assert.equal(profile.number('score').value, 12.5);
});
