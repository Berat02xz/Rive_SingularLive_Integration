import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../RiveLink/source/output.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function model(name, fields) {
  const result = {viewModelName: name, fields,
    properties: Object.entries(fields).map(([name, field]) => ({name, type: field.type}))};
  result.nativeInstance = {isAliasOf(other) { return this === other; }};
  function lookup(path) {
    const parts = path.split('/');
    let current = result;
    for (const key of parts.slice(0, -1)) current = current?.fields[key]?.instance;
    return current?.fields[parts.at(-1)];
  }
  for (const type of ['string', 'number', 'boolean', 'image', 'font', 'color', 'list', 'trigger', 'artboard']) {
    result[type] = path => { const field = lookup(path); return field?.type === type ? field.accessor : null; };
  }
  result.enum = path => lookup(path)?.type === 'enumType' ? lookup(path).accessor : null;
  result.viewModel = path => lookup(path)?.instance || null;
  return result;
}
function field(type, initial) {
  let value = initial;
  return {type, accessor: {get value() {return value;}, set value(next) {
    if (['string', 'number', 'boolean'].includes(type)) assert.equal(typeof next, type);
    value = next;
  }}};
}
function row(values = {}, name = 'Row') {
  const result = model(name, {
    id: field('string', ''), title: field('string', 'authored'), subtitle: field('string', 'subtitle'),
    visible: field('boolean', true), size__: field('number', 24), score: field('number', 5),
    ordinaryNumber: field('number', 0), normalizedNumber: field('number', 0), counter: field('number', 0),
  });
  for (const [key, value] of Object.entries(values)) result.fields[key].accessor.value = value;
  return result;
}
function list(initial) {
  return {
    rows: [...initial], removed: 0, failAdd: false,
    get length() {return this.rows.length;},
    instanceAt(i) {return this.rows[i];},
    addInstance(value) {if (this.failAdd) return false; this.rows.push(value); return true;},
    addInstanceAt(value, i) {if (this.failAdd) return false; this.rows.splice(i, 0, value); return true;},
    removeInstanceAt(i) {this.removed++; this.rows.splice(i, 1);},
    swap(a, b) {[this.rows[a], this.rows[b]] = [this.rows[b], this.rows[a]];},
  };
}
function setup(initial = [row()], itemVMName = 'Row') {
  const warnings = [], plays = [];
  const rows = list(initial);
  const root = model('Root', {rows: {type: 'list', accessor: rows}});
  const definitions = new Map([['Row', {properties: row().properties, defaultInstance: () => row(),
    instance: () => row({size__: 0, visible: false})}]]);
  const runtime = {viewModelInstance: root, viewModelByName: name => definitions.get(name), play: name => plays.push(name)};
  const context = {window: {addEventListener() {}, rive: {}}, document: {}, SingularWidget: {init() {}},
    console: {warn: (...args) => warnings.push(args), info() {}, log() {}},
    setTimeout, clearTimeout, Uint8Array};
  vm.runInNewContext(script + ';globalThis.api={widgetState,handleListUpdate,applyPropsToInstance,readInstanceProperties,handleScalarUpdate,normalizeScalarValue,updateDynamicProperties};', context);
  const api = context.api;
  Object.assign(api.widgetState, {r: runtime, stateMachineName: 'Machine', _findVMNameForInstance: inst => inst?.viewModelName});
  const prop = {type: 'list', path: 'rows', ownerInstance: root, accessor: rows, itemVMName};
  return {api, rows, prop, root, runtime, warnings, plays, definitions,
    apply: data => api.handleListUpdate(prop, data)};
}

test('first JSON update retains authored row identity and internal styling', () => {
  const original = row(); const x = setup([original]);
  x.apply([{title: 'TestTest', subtitle: 'tetetet', visible: true}]);
  assert.equal(x.rows.instanceAt(0), original);
  assert.equal(original.string('title').value, 'TestTest');
  assert.equal(original.number('size__').value, 24);
  assert.equal(x.rows.removed, 0);
  assert.deepEqual(x.plays, ['Machine']);
});

test('growing a list creates independent authored default instances', () => {
  const x = setup(); x.apply([{title: 'first'}, {title: 'second'}]);
  assert.equal(x.rows.length, 2);
  assert.equal(x.rows.instanceAt(1).number('size__').value, 24);
  assert.notEqual(x.rows.instanceAt(0), x.rows.instanceAt(1));
  assert.equal(x.rows.instanceAt(0).string('title').value, 'first');
});

test('clearing and repopulating retains the inferred model and authored defaults', () => {
  const x = setup(); x.apply([]); assert.equal(x.rows.length, 0);
  x.apply([{title: 'repopulated'}]);
  assert.equal(x.rows.instanceAt(0).string('title').value, 'repopulated');
  assert.equal(x.rows.instanceAt(0).number('size__').value, 24);
});

for (const key of ['table', 'customControlNodeId']) {
  test(`table wrapper ${key} accepts rows without a hardcoded node name`, () => {
    const x = setup(); x.apply({[key]: [{title: 'wrapped'}]});
    assert.equal(x.rows.length, 1);
    assert.equal(x.rows.instanceAt(0).string('title').value, 'wrapped');
  });
}

test('JSON strings, array objects, and single rows use the same list path', () => {
  const x = setup();
  x.apply(JSON.stringify({table: [{title: 'string wrapper'}]}));
  assert.equal(x.rows.instanceAt(0).string('title').value, 'string wrapper');
  x.apply({title: 'single row'});
  assert.equal(x.rows.instanceAt(0).string('title').value, 'single row');
});

test('invalid list structure cannot delete or replace live rows', () => {
  const original = row(); const x = setup([original]);
  for (const invalid of [null, 'broken JSON', 2, [null], [{title: 'partial'}, 'bad'], {groups: [], fields: {}}]) x.apply(invalid);
  assert.equal(x.rows.length, 1);
  assert.equal(x.rows.instanceAt(0), original);
  assert.equal(original.string('title').value, 'authored');
  assert.equal(x.rows.removed, 0);
  assert.equal(x.warnings.length, 6);
});

test('numeric strings are converted according to the row schema', () => {
  const x = setup(); x.apply([{score: '12.5', title: '0012'}]);
  assert.equal(x.rows.instanceAt(0).number('score').value, 12.5);
  assert.equal(x.rows.instanceAt(0).string('title').value, '0012');
});

test('all three numeric transport variants preserve values without rescaling', () => {
  const x = setup();
  x.apply([{ordinaryNumber: '12.5', normalizedNumber: 50, counter: 3}]);
  const first = x.rows.instanceAt(0);
  assert.equal(first.number('ordinaryNumber').value, 12.5);
  assert.equal(first.number('normalizedNumber').value, 50);
  assert.equal(first.number('counter').value, 3);
  x.apply([{ordinaryNumber: 12.5, normalizedNumber: '0.5', counter: '4'}]);
  assert.equal(first.number('ordinaryNumber').value, 12.5);
  assert.equal(first.number('normalizedNumber').value, 0.5);
  assert.equal(first.number('counter').value, 4);
});

test('invalid numeric values preserve the old value and report the property', () => {
  const x = setup();
  for (const value of ['', '   ', null, false, '12px', '12,5', Infinity, 'Infinity']) x.apply([{score: value}]);
  assert.equal(x.rows.instanceAt(0).number('score').value, 5);
  assert.ok(x.warnings.every(args => args[1].properties[0].path === 'rows/0/score'));
});

test('boolean strings do not turn false into true', () => {
  const x = setup(); x.apply([{visible: 'false'}]);
  assert.equal(x.rows.instanceAt(0).boolean('visible').value, false);
  x.apply([{visible: '1'}]); assert.equal(x.rows.instanceAt(0).boolean('visible').value, true);
  x.apply([{visible: 'maybe'}]); assert.equal(x.rows.instanceAt(0).boolean('visible').value, true);
  assert.equal(x.warnings.length, 1);
});

test('ordinary dynamic numeric and boolean controls use the same normalization', () => {
  const x = setup(); const number = field('number', 5), boolean = field('boolean', true);
  x.api.widgetState.riveProps = {
    score: {type: 'number', accessor: number.accessor, path: 'score'},
    visible: {type: 'boolean', accessor: boolean.accessor, path: 'visible'},
  };
  x.api.updateDynamicProperties({score: '2.25', visible: 'false'});
  assert.equal(number.accessor.value, 2.25); assert.equal(boolean.accessor.value, false);
  x.api.updateDynamicProperties({score: ''}); assert.equal(number.accessor.value, 2.25);
});

test('internal animation values cannot be overwritten through row JSON', () => {
  const x = setup(); x.apply([{title: 'safe', size__: 0, _private: 'ignored'}]);
  assert.equal(x.rows.instanceAt(0).number('size__').value, 24);
});

test('nested row models and enum values round-trip through JSON', () => {
  const nested = model('Profile', {score: field('number', 1), enabled: field('boolean', true)});
  const entry = model('Row', {profile: {type: 'viewModel', instance: nested},
    mode: {type: 'enumType', accessor: {value: 'Clock', values: ['Clock', 'Timer']}}});
  const x = setup([entry]);
  x.apply([{profile: {score: '3.5', enabled: 'false'}, mode: 'Timer'}]);
  const saved = x.api.readInstanceProperties(entry);
  assert.equal(saved.profile.score, 3.5); assert.equal(saved.profile.enabled, false); assert.equal(saved.mode, 'Timer');
  x.apply([{mode: '0'}]); assert.equal(entry.enum('mode').value, 'Clock');
});

test('stable IDs preserve rows when deleting and reordering', () => {
  const a = row({id: 'a', title: 'A'}), b = row({id: 'b', title: 'B'}), c = row({id: 'c', title: 'C'});
  const x = setup([a, b, c]);
  x.apply([{id: 'a', title: 'A'}, {id: 'b', title: 'B'}, {id: 'c', title: 'C'}]);
  x.apply([{id: 'c', title: 'C'}, {id: 'a', title: 'A'}]);
  assert.equal(x.rows.length, 2); assert.equal(x.rows.instanceAt(0), c); assert.equal(x.rows.instanceAt(1), a);
});

test('an unchanged payload restores keyed order after a runtime sort', () => {
  const a = row({id: 'a'}), b = row({id: 'b'}); const x = setup([a, b]);
  const data = [{id: 'a'}, {id: 'b'}]; x.apply(data); x.rows.rows.reverse(); x.apply(data);
  assert.equal(x.rows.instanceAt(0), a); assert.equal(x.rows.instanceAt(1), b);
  assert.equal(x.plays.length, 2);
  x.apply(data); assert.equal(x.plays.length, 2);
});

test('failed row creation remains retryable with identical JSON', () => {
  const x = setup([], null); const data = [{_vm: 'Late', title: 'retry'}]; x.apply(data);
  assert.equal(x.rows.length, 0); assert.equal(x.prop._lastListData, undefined);
  x.definitions.set('Late', {defaultInstance: () => row({}, 'Late'), properties: row().properties});
  x.apply(data); assert.equal(x.rows.length, 1); assert.equal(x.rows.instanceAt(0).string('title').value, 'retry');
});

test('failed insertion is detected and can be retried', () => {
  const x = setup([]); x.rows.failAdd = true; const data = [{title: 'retry'}]; x.apply(data);
  assert.equal(x.prop._lastListData, undefined); x.rows.failAdd = false; x.apply(data);
  assert.equal(x.rows.length, 1);
});

test('a missing row model cannot shift later rows into the failed row position', () => {
  const x = setup([]);
  const data = [{_vm: 'Late', title: 'first'}, {_vm: 'Row', title: 'second'}];
  x.apply(data); assert.equal(x.rows.length, 0);
  x.definitions.set('Late', {properties: row().properties, defaultInstance: () => row({}, 'Late')});
  x.apply(data);
  assert.equal(x.rows.length, 2);
  assert.equal(x.rows.instanceAt(0).string('title').value, 'first');
  assert.equal(x.rows.instanceAt(1).string('title').value, 'second');
});

test('numeric row IDs, including zero, preserve identity during reordering', () => {
  const a = model('Row', {id: field('number', 0), title: field('string', 'A')});
  const b = model('Row', {id: field('number', 1), title: field('string', 'B')});
  const x = setup([a, b]);
  x.apply([{id: 0, title: 'A'}, {id: 1, title: 'B'}]);
  x.apply([{id: '1', title: 'B'}, {id: '0', title: 'A'}]);
  assert.equal(x.rows.instanceAt(0), b); assert.equal(x.rows.instanceAt(1), a);
});

test('explicit row model changes replace the row with that model default', () => {
  const original = row(); const x = setup([original]);
  x.definitions.set('Other', {properties: row().properties, defaultInstance: () => row({}, 'Other')});
  x.apply([{_vm: 'Other', title: 'other'}]);
  assert.equal(x.rows.instanceAt(0).viewModelName, 'Other');
  assert.equal(x.rows.instanceAt(0).string('title').value, 'other');
  assert.equal(x.rows.instanceAt(0).number('size__').value, 24);
});

test('removed created rows are not retained in the widget list bookkeeping', () => {
  const x = setup([]); x.apply([{title: 'one'}, {title: 'two'}]);
  assert.equal(x.prop.addedInstances.length, 2); x.apply([]); assert.equal(x.prop.addedInstances.length, 0);
});
