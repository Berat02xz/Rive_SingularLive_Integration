import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discover, field, list, model, plain, row, setupViewModels} from './helpers/widget-harness.mjs';

test('View Models: discovery uses the bound artboard instance instead of another definition or default', () => {
  const bound = model('Selected', {title: field('string', 'selected')}), x = setupViewModels(bound);
  x.runtime.defaultViewModel = () => ({name: 'Other', defaultInstance() {assert.fail('must retain auto-bound instance');}});
  x.runtime.viewModelByIndex = () => {assert.fail('must not enumerate unrelated definitions for a named instance');};
  const result = discover(x);
  assert.equal(result.defaultVMName, 'Selected');
  assert.equal(result.props.title.accessor, bound.string('title'));
});

test('View Models: a missing binding is created only from the selected artboard definition', () => {
  const bound = model('Selected', {title: field('string', 'default')}), x = setupViewModels(bound), bindings = [];
  x.runtime.viewModelInstance = null;
  x.runtime.defaultViewModel = () => ({name: 'Selected', defaultInstance: () => bound, instance() {assert.fail('authored default exists');}});
  x.runtime.bindViewModelInstance = value => bindings.push(value);
  const result = discover(x);
  assert.deepEqual(bindings, [bound]); assert.equal(result.props.title.accessor, bound.string('title'));
});

test('View Models: blank instance is a fallback only when the authored default is absent', () => {
  const bound = model('Selected', {title: field('string', '')}), x = setupViewModels(bound);
  x.runtime.viewModelInstance = null;
  x.runtime.defaultViewModel = () => ({name: 'Selected', defaultInstance: () => null, instance: () => bound});
  let binding;
  x.runtime.bindViewModelInstance = value => {binding = value;};
  assert.equal(discover(x).props.title.accessor, bound.string('title')); assert.equal(binding, bound);
});

test('View Models: no selected artboard model yields no unrelated artboard controls', () => {
  const x = setupViewModels(model('Main', {}));
  x.runtime.viewModelInstance = null; x.runtime.defaultViewModel = () => null;
  x.runtime.viewModelByIndex = () => {assert.fail('unrelated models must not be exposed');};
  const result = discover(x);
  assert.deepEqual(Object.keys(result.props), []); assert.equal(result.defaultVMName, '');
});

test('View Models: older runtimes without the globals API still discover the bound model', () => {
  const x = setupViewModels(model('Main', {score: field('number', 1)}));
  delete x.runtime.globalViewModelNames;
  const result = discover(x);
  assert.deepEqual(Object.keys(result.props), ['score']); assert.deepEqual([...result.globalViewModelNames], []);
});

test('View Models: a broken global accessor does not hide working Main or global properties', () => {
  const good = model('Good', {score: field('number', 1)}), x = setupViewModels(model('Main', {title: field('string', '')}), {Good: good});
  x.runtime.globalViewModelNames = () => ['Bad', null, '', 42, 'Good'];
  x.runtime.globalViewModelInstance = name => {if (name === 'Bad') throw Error('unavailable'); return good;};
  const result = discover(x);
  assert.deepEqual(Object.keys(result.props), ['global:Good:score', 'title']);
  assert.deepEqual([...result.globalViewModelNames], ['Good']);
});

test('nested View Models: same definition can occur at multiple depths and sibling paths', () => {
  const leaf = model('Node', {score: field('number', 1)});
  const child = model('Node', {score: field('number', 2), child: {type: 'viewModel', instance: leaf}});
  const main = model('Main', {left: {type: 'viewModel', instance: child}, right: {type: 'viewModel', instance: leaf}});
  const x = setupViewModels(main);
  assert.deepEqual(Object.keys(x.discovered.props), ['left/score', 'left/child/score', 'right/score']);
  x.api.updateDynamicProperties({leftscore: '12.5', leftchildscore: '2.25'});
  assert.equal(child.number('score').value, 12.5); assert.equal(leaf.number('score').value, 2.25);
  assert.equal(x.warnings.length, 0);
});

test('nested View Models: actual instance cycles stop without hiding safe sibling properties', () => {
  const fields = {title: field('string', 'safe')}, cyclic = model('Loop', fields);
  fields.loop = {type: 'viewModel', instance: cyclic}; cyclic.properties.push({name: 'loop', type: 'viewModel'});
  const x = setupViewModels(cyclic);
  assert.deepEqual(Object.keys(x.discovered.props), ['title']);
  assert.equal(x.warnings.length, 1);
  assert.deepEqual(plain(x.api.readInstanceProperties(cyclic)), {title: 'safe', loop: {}});
});

test('nested View Models: native aliases count as cycles even when wrappers differ', () => {
  const alias = model('Loop', {title: field('string', 'alias')});
  const main = model('Main', {title: field('string', 'safe'), loop: {type: 'viewModel', instance: alias}});
  main.nativeInstance.isAliasOf = native => native === alias.nativeInstance;
  const x = setupViewModels(main);
  assert.deepEqual(Object.keys(x.discovered.props), ['title']); assert.equal(x.warnings.length, 1);
});

test('nested View Models: an unbound child reports its path but keeps the parent controls', () => {
  const x = setupViewModels(model('Main', {title: field('string', 'safe'), missing: {type: 'viewModel', instance: null}}));
  assert.deepEqual(Object.keys(x.discovered.props), ['title']);
  assert.equal(x.warnings[0][1].path, 'missing');
});

test('nested View Models: depth guard bounds discovery and JSON serialization', () => {
  let nested = model('Node', {value: field('number', 1)});
  for (let i = 0; i < 70; i++) nested = model('Node', {value: field('number', i), child: {type: 'viewModel', instance: nested}});
  const x = setupViewModels(nested);
  assert.equal(Object.keys(x.discovered.props).length, 64); assert.equal(x.warnings.length, 1);
  let saved = x.api.readInstanceProperties(nested), levels = 0;
  while ('child' in saved) {levels++; saved = saved.child;}
  assert.equal(levels, 64);
});

test('internal properties: internal subtrees stay hidden and all public updates leave them untouched', () => {
  const child = model('Private', {score: field('number', 9)});
  let triggers = 0;
  const main = model('Main', {title: field('string', 'visible'), size__: field('number', 24),
    private__: {type: 'viewModel', instance: child}, refresh__: {type: 'trigger', accessor: {trigger() {triggers++;}}}});
  const x = setupViewModels(main);
  x.api.generateUIModel();
  assert.deepEqual(plain(x.publications[0].fields.map(item => item.id)), ['title']);
  x.api.updateDynamicProperties({size: 0, privateScore: 0, private__score: 0});
  x.api.onSingularButtonClicked('refresh');
  x.api.applyPropsToInstance(main, {size__: 0, private__: {score: 0}, refresh__: true});
  assert.equal(main.number('size__').value, 24); assert.equal(child.number('score').value, 9); assert.equal(triggers, 0);
  assert.deepEqual(plain(x.api.readInstanceProperties(main)), {title: 'visible'});
});

test('property IDs: legacy root and nested names preserve capitalization and target only their own accessor', async () => {
  const nested = model('Live', {inOut: field('boolean', false)});
  const main = model('Main', {color1: field('string', 'main'), propertyOfLive: {type: 'viewModel', instance: nested}});
  const x = setupViewModels(main);
  assert.equal(x.discovered.props.color1.fieldId, 'color1');
  assert.equal(x.discovered.props['propertyOfLive/inOut'].fieldId, 'propertyOfLiveinOut');
  await x.api.onSingularValue({propertyofliveinout: true, COLOR1: 'wrong case'});
  assert.equal(nested.boolean('inOut').value, false); assert.equal(main.string('color1').value, 'main');
  await x.api.onSingularValue({propertyOfLiveinOut: true, color1: 'updated'});
  assert.equal(nested.boolean('inOut').value, true); assert.equal(main.string('color1').value, 'updated');
});

test('property IDs: ambiguous sanitized paths stay unique and stable across discovery order', () => {
  const entries = [['score value', field('number', 1)], ['score-value', field('number', 2)], ['riveartboard', field('string', 'safe')], ['!!!', field('number', 3)]];
  const a = setupViewModels(model('Main', Object.fromEntries(entries)));
  const b = setupViewModels(model('Main', Object.fromEntries([...entries].reverse())));
  const ids = Object.values(a.discovered.props).map(prop => prop.fieldId);
  // These IDs can be saved in customer overlays; keep exact compatibility fixtures.
  assert.deepEqual(Object.fromEntries(Object.entries(a.discovered.props).map(([name, prop]) => [name, prop.fieldId])), {
    'score value': 'scorevalue5krgth', 'score-value': 'scorevalue1o7m50o',
    riveartboard: 'riveartboardn0gxg5', '!!!': 'rivepropertypmxdaf',
  });
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every(id => /^[a-zA-Z0-9]+$/.test(id) && id !== 'riveartboard'));
  for (const key of Object.keys(a.discovered.props)) assert.equal(a.discovered.props[key].fieldId, b.discovered.props[key].fieldId);
  a.api.updateDynamicProperties({[a.discovered.props['score value'].fieldId]: '12.5'});
  assert.equal(a.runtime.viewModelInstance.number('score value').value, 12.5);
  assert.equal(a.runtime.viewModelInstance.number('score-value').value, 2);
});

test('globals: Model name is dynamic, and Main and globals with matching property names remain independent', async () => {
  const main = model('Main', {score: field('number', 1)}), theme = model('Theme', {score: field('number', 2)});
  const x = setupViewModels(main, {Theme: theme});
  await x.callbacks.onValue({Themescore: '12.5', score: '4'});
  assert.equal(theme.number('score').value, 12.5); assert.equal(main.number('score').value, 4);
  assert.equal(x.discovered.props['global:Theme:score'].fieldId, 'Themescore');
});

test('globals: a global-only file is exposed even when the artboard has no View Model', () => {
  const global = model('Theme', {enabled: field('boolean', true)}), x = setupViewModels(model('Main', {}), {Theme: global});
  x.runtime.viewModelInstance = null;
  x.runtime.defaultViewModel = () => ({name: 'Theme', defaultInstance() {assert.fail('must not bind globals as a Main fallback');}});
  const result = discover(x);
  assert.deepEqual(Object.keys(result.props), ['global:Theme:enabled']);
  x.api.generateUIModel(); assert.equal(x.publications.at(-1).groups[0].title, 'Theme');
});

test('artboard changes: discovery replaces previous nested metadata and font accessors', () => {
  const oldChild = model('OldChild', {font: field('font', null)});
  const x = setupViewModels(model('Old', {oldChild: {type: 'viewModel', instance: oldChild}}));
  x.runtime.viewModelInstance = model('New', {title: field('string', 'new')});
  x.runtime.defaultViewModel = () => ({name: 'New'});
  discover(x); x.api.generateUIModel();
  assert.deepEqual(Object.keys(x.api.widgetState.vmMetadata), ['']);
  assert.deepEqual(Object.keys(x.api.widgetState.dataBoundFontProperties), []);
  assert.deepEqual(plain(x.publications[0].fields.map(field => field.id)), ['title']);
  assert.deepEqual(plain(x.publications[0].groups.map(group => group.title)), ['New']);
});

test('lists: discovery uses the owning nested/global instance rather than the Main list', () => {
  const mainRows = list([row({title: 'main'})]), globalRows = list([row({title: 'global'})]);
  const childRows = list([row({title: 'child'})]);
  const child = model('Child', {rows: {type: 'list', accessor: childRows}});
  const x = setupViewModels(model('Main', {rows: {type: 'list', accessor: mainRows}, child: {type: 'viewModel', instance: child}}),
    {Theme: model('Theme', {rows: {type: 'list', accessor: globalRows}})});
  x.api.updateDynamicProperties({Themerows: [{title: 'global update'}], childrows: [{title: 'child update'}]});
  assert.equal(mainRows.instanceAt(0).string('title').value, 'main');
  assert.equal(globalRows.instanceAt(0).string('title').value, 'global update');
  assert.equal(childRows.instanceAt(0).string('title').value, 'child update');
});

test('View Models: unsupported and inaccessible properties do not break valid controls', () => {
  const main = model('Main', {score: field('number', 1), bad: field('image', null), future: {type: 'futureType'}});
  main.image = () => {throw Error('accessor unavailable');};
  const x = setupViewModels(main);
  assert.deepEqual(Object.keys(x.discovered.props), ['score']);
  x.api.generateUIModel(); assert.equal(x.publications[0].fields[0].id, 'score');
});

test('triggers: exact registered IDs fire Main, nested and global controls independently', () => {
  const fired = [], trigger = name => ({type: 'trigger', accessor: {trigger() {fired.push(name);}}});
  const child = model('Child', {go: trigger('nested')});
  const x = setupViewModels(model('Main', {go: trigger('main'), child: {type: 'viewModel', instance: child}}),
    {Theme: model('Theme', {go: trigger('global')})});
  for (const id of ['childgo', 'Themego', 'go', 'unknown']) x.callbacks.onButtonClicked(id);
  assert.deepEqual(fired, ['nested', 'global', 'main']);
  x.api.updateDynamicProperties({go: true});
  assert.deepEqual(fired, ['nested', 'global', 'main']);
});
