import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {field, list, model, plain, row, setupViewModels} from './helpers/widget-harness.mjs';

const cases = [
  ['string', field('string', '0012'), 'text', '0012'],
  ['number', field('number', 12.5), 'number', 12.5],
  ['boolean', field('boolean', false), 'checkbox', false],
  ['image', field('image', {}), 'image', ''],
  ['font', field('font', {}), 'metricfont', {fontData: {family: 'Inter', weight: '400', subset: 'auto'}}],
  ['color', field('color', 0x80123456), 'color', {r: 18, g: 52, b: 86, a: 128 / 255}],
  ['trigger', {type: 'trigger', accessor: {trigger() {}}}, 'button', ''],
  ['enum', {type: 'enum', accessor: {value: 'Timer', values: ['Clock', 'Timer']}}, 'selection', '1'],
  ['enumType', {type: 'enumType', accessor: {value: 'Clock', values: ['Clock', 'Timer']}}, 'selection', '0'],
];
for (const [kind, property, expectedType, expectedDefault] of cases) {
  test(`controls: ${kind} publishes the correct Singular type and authored default`, () => {
    const x = setupViewModels(model('Main', {value: property}));
    x.api.generateUIModel();
    const control = x.publications[0].fields[0];
    assert.equal(control.id, kind === 'font' ? 'rivefontpropvalue' : 'value');
    assert.equal(control.type, expectedType); assert.deepEqual(plain(control.defaultValue), expectedDefault);
    if (kind === 'number') assert.equal(control.step, '0.1');
    if (kind.startsWith('enum')) assert.deepEqual(plain(control.selections), [{id: '0', title: 'Clock'}, {id: '1', title: 'Timer'}]);
  });
}

test('controls: list defaults serialize public row values and retain the inferred row model', () => {
  const rows = list([row({score: 3.5})]), x = setupViewModels(model('Main', {rows: {type: 'list', accessor: rows}}));
  x.api.generateUIModel();
  const control = x.publications[0].fields[0], saved = JSON.parse(control.defaultValue);
  assert.equal(control.type, 'json'); assert.equal(control.width, '350'); assert.equal(control.height, '200');
  assert.equal(saved[0].score, 3.5); assert.equal(saved[0].title, 'authored');
  assert.equal(saved[0].size__, undefined); assert.equal(saved[0]._vm, undefined);
  assert.equal(x.discovered.props.rows.itemVMName, 'Row');
});

test('controls: empty lists have valid empty JSON instead of null or a blank field', () => {
  const x = setupViewModels(model('Main', {rows: {type: 'list', accessor: list([])}}));
  x.api.generateUIModel(); assert.equal(x.publications[0].fields[0].defaultValue, '[]');
});

test('controls: artboard property choices exclude the current artboard and retain file indices', () => {
  const x = setupViewModels(model('Main', {slot: field('artboard', 'Third')})), released = [];
  x.api.widgetState.artboardName = 'Main';
  const names = ['First', 'Main', 'Third'];
  x.runtime.file = {artboardCount: () => 3, artboardByIndex: i => ({name: () => names[i], delete() {released.push(i);}}),
    defaultArtboard: () => ({name: 'First', delete() {released.push('default');}})};
  x.api.generateUIModel();
  const ui = x.publications[0], slot = ui.fields.find(field => field.id === 'slot');
  assert.deepEqual(plain(slot.selections), [{id: '0', title: 'First'}, {id: '2', title: 'Third'}]);
  assert.equal(slot.defaultValue, '2');
  assert.equal(ui.fields.find(field => field.id === 'riveartboard').defaultValue, '1');
  assert.deepEqual(released, [0, 1, 2, 'default']);
});

test('controls: referenced asset IDs, saved values and types remain compatible', () => {
  const x = setupViewModels(model('Main', {}), {}, {
    referencedFontAssets: {rivefontExampleFamily: {fieldId: 'rivefontExampleFamily', assetName: 'ExampleFamily-Regular.ttf'}},
    referencedAudioAssets: {riveaudioIntroSound: {fieldId: 'riveaudioIntroSound', assetName: 'Intro Sound.wav'}},
    metricFontData: {rivefontExampleFamily: {family: 'Override', weight: '700', subset: 'latin'}},
    audioAssetUrls: {riveaudioIntroSound: 'https://media.test/intro.wav'},
  });
  x.api.generateUIModel(); const ui = x.publications[0];
  assert.deepEqual(plain(ui.fields), [
    {id: 'rivefontExampleFamily', type: 'metricfont', title: 'ExampleFamily-Regular', defaultValue: {fontData: {family: 'Override', weight: '700', subset: 'latin'}}},
    {id: 'riveaudioIntroSound', type: 'audio', title: 'Intro Sound', defaultValue: 'https://media.test/intro.wav'},
  ]);
  assert.deepEqual(plain(ui.groups.map(group => group.title)), ['Fonts', 'Audio']);
  assert.ok(ui.groups.every(group => !group.toolTip.includes('Composition Scripting')));
});

test('controls: nested group titles show their complete hierarchy and tooltips show real scripting IDs', () => {
  const scoreboard = model('Scoreboard', {inOut: field('boolean', false)});
  const child = model('Live', {title: field('string', ''), propertyOfScoreboard: {type: 'viewModel', instance: scoreboard}});
  const main = model('Main', {score: field('number', 0), propertyOfLive: {type: 'viewModel', instance: child}});
  const x = setupViewModels(main, {Theme: model('Theme', {color1: field('color', 0xff000000)})});
  x.api.generateUIModel(); const groups = x.publications[0].groups;
  assert.deepEqual(plain(groups.map(group => group.title)), [
    'Theme', 'Main', 'propertyOfLive : Live', 'propertyOfLive : Live → propertyOfScoreboard : Scoreboard',
  ]);
  assert.equal(groups[0].toolTip, 'Properties of "Theme" Global View Model.\nWhen targeted via Composition Scripting, all properties must use the Theme prefix.\nExample: Themecolor1.');
  assert.equal(groups[1].toolTip, 'Properties of "Main".\nWhen targeted via Composition Scripting, use each property\'s exact field ID.\nExample: score.');
  assert.equal(groups[3].toolTip, 'Properties of propertyOfScoreboard nested View Model within Live View Model.\nWhen targeted via Composition Scripting, all properties must use the propertyOfLivepropertyOfScoreboard prefix.\nExample: propertyOfLivepropertyOfScoreboardinOut.');
  const fields = new Set(x.publications[0].fields.map(field => field.id));
  assert.equal(new Set(groups.map(group => group.id)).size, groups.length);
  for (const group of groups) {
    assert.ok(group.childIds.every(id => fields.has(id)));
    assert.ok(group.toolTip.split('\n').every(line => line.endsWith('.')));
  }
});

test('controls: static configuration IDs and layout choices agree with runtime routing', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../RiveLink/source/widget_ui_config.json', import.meta.url), 'utf8')).model;
  const x = setupViewModels(model('Main', {}));
  assert.deepEqual(config.fields.map(field => field.id), ['rive_file_url', 'rive_layout', 'rive_renderer', 'show_fps']);
  const layouts = config.fields.find(field => field.id === 'rive_layout').selections;
  assert.deepEqual(layouts.map(value => value.id), ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(layouts.map(value => value.title.replaceAll(' ', '')), [...x.api.widgetState.layoutOptions]);
  assert.equal(config.groups[0].toolTip, 'Configure Rive file source, layout and renderer.');
  assert.ok(!config.groups[0].toolTip.includes('Composition Scripting'));
});

test('enums: direct controls accept selection IDs and ignore out-of-range values', async () => {
  const mode = {type: 'enumType', accessor: {value: 'Clock', values: ['Clock', 'Timer']}};
  const x = setupViewModels(model('Main', {mode}));
  await x.callbacks.onValue({mode: '1'}); assert.equal(mode.accessor.value, 'Timer');
  for (const value of [-1, 2, '', 'unknown', null]) {
    await x.callbacks.onValue({mode: value}); assert.equal(mode.accessor.value, 'Timer');
  }
  await x.callbacks.onValue({mode: '0'}); assert.equal(mode.accessor.value, 'Clock');
});

test('colors: hex RGB, hex RGBA and Singular objects produce the expected Rive channels', async () => {
  const writes = [], x = setupViewModels(model('Main', {color: {type: 'color', accessor: {value: 0, rgba: (...args) => writes.push(args)}}}));
  for (const value of ['#123456', '#12345680', {r: 12.2, g: 34.8, b: 56, a: 0.5}, {r: 1, g: 2, b: 3}]) await x.callbacks.onValue({color: value});
  assert.deepEqual(writes, [[18, 52, 86, 255], [18, 52, 86, 128], [12, 35, 56, 128], [1, 2, 3, 255]]);
});

test('property errors: one invalid boolean cannot prevent a valid sibling update', async () => {
  const main = model('Main', {enabled: field('boolean', true), score: field('number', 1)}), x = setupViewModels(main);
  await x.callbacks.onValue({enabled: 'maybe', score: '12.5'});
  assert.equal(main.boolean('enabled').value, true); assert.equal(main.number('score').value, 12.5);
  assert.equal(x.warnings.length, 1); assert.equal(x.warnings[0][1].id, 'enabled');
});

test('artboard properties: selection IDs load and assign the selected file artboard', async () => {
  const slot = field('artboard', 'old'), x = setupViewModels(model('Main', {slot})), loaded = [], selected = {};
  x.api.widgetState.fileUrl = 'https://files.test/a.riv';
  x.runtime.file = {artboardCount: () => 3, artboardByIndex: index => ({name: ['Main', 'Card', 'Badge'][index]})};
  x.fontRuntime.RiveFile = class {
    constructor(config) {this.config = config;}
    init() {loaded.push(this.config.src); this.config.onLoad();}
    getArtboard(name) {assert.equal(name, 'Badge'); return selected;}
  };
  await x.callbacks.onValue({slot: '2'});
  assert.equal(slot.accessor.value, selected); assert.deepEqual(loaded, ['https://files.test/a.riv']);
  await x.callbacks.onValue({slot: '999'});
  assert.equal(slot.accessor.value, selected); assert.equal(loaded.length, 1);
});

test('font grouping: Main, nested and global font properties stay in their owning VM; referenced assets have separate groups', () => {
  const child = model('Live', {font1: field('font', null)});
  const main = model('Main', {font1: field('font', null), propertyOfLive: {type: 'viewModel', instance: child}});
  const x = setupViewModels(main, {Theme: model('Theme', {font1: field('font', null)})}, {
    referencedFontAssets: {rivefontExample: {fieldId: 'rivefontExample', assetName: 'Example-Regular.ttf'}},
    referencedAudioAssets: {riveaudioTrack: {fieldId: 'riveaudioTrack', assetName: 'Track.wav'}},
  });
  x.api.generateUIModel();
  const groups = x.publications[0].groups;
  assert.deepEqual(plain(groups.map(group => ({title: group.title, fields: group.childIds}))), [
    {title: 'Theme', fields: ['Themefont1']},
    {title: 'Main', fields: ['rivefontpropfont1']},
    {title: 'propertyOfLive : Live', fields: ['rivefontproppropertyOfLivefont1']},
    {title: 'Fonts', fields: ['rivefontExample']},
    {title: 'Audio', fields: ['riveaudioTrack']},
  ]);
  assert.equal(groups[0].toolTip, 'Properties of "Theme" Global View Model.\nWhen targeted via Composition Scripting, all properties must use the Theme prefix.\nExample: Themefont1.');
  assert.equal(groups[1].toolTip, 'Properties of "Main".\nWhen targeted via Composition Scripting, use each property\'s exact field ID.\nExample: rivefontpropfont1.');
  assert.equal(groups[2].toolTip, 'Properties of propertyOfLive nested View Model within Main View Model.\nWhen targeted via Composition Scripting, use each property\'s exact field ID.\nExample: rivefontproppropertyOfLivefont1.');
  assert.equal(groups[3].toolTip, 'Font overrides for referenced text assets in the Rive file.');
  assert.equal(groups[4].toolTip, 'Audio overrides for referenced audio assets in the Rive file.');
});

test('font grouping: a mixed nested group uses exact-ID guidance rather than advertising an incorrect shared prefix', () => {
  const child = model('Live', {title: field('string', ''), font1: field('font', null)});
  const x = setupViewModels(model('Main', {propertyOfLive: {type: 'viewModel', instance: child}}));
  x.api.generateUIModel();
  const group = x.publications[0].groups[0];
  assert.deepEqual(plain(group.childIds), ['propertyOfLivetitle', 'rivefontproppropertyOfLivefont1']);
  assert.ok(group.toolTip.includes("use each property's exact field ID."));
  assert.ok(!group.toolTip.includes('all properties must use the propertyOfLive prefix'));
  assert.ok(group.toolTip.endsWith('Example: propertyOfLivetitle.'));
});
