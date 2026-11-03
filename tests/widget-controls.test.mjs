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
    assert.equal(control.id, 'value');
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

test('controls: referenced assets use plain names and retain saved values and types', () => {
  const x = setupViewModels(model('Main', {}), {}, {
    referencedFontAssets: {ExampleFamilyRegular: {fieldId: 'ExampleFamilyRegular', assetName: 'ExampleFamily-Regular.ttf'}},
    referencedAudioAssets: {IntroSound: {fieldId: 'IntroSound', assetName: 'Intro Sound.wav'}},
    metricFontData: {ExampleFamilyRegular: {family: 'Override', weight: '700', subset: 'latin'}},
    audioAssetUrls: {IntroSound: 'https://media.test/intro.wav'},
  });
  x.api.generateUIModel(); const ui = x.publications[0];
  assert.deepEqual(plain(ui.fields), [
    {id: 'ExampleFamilyRegular', type: 'metricfont', title: 'ExampleFamily-Regular', defaultValue: {fontData: {family: 'Override', weight: '700', subset: 'latin'}}},
    {id: 'IntroSound', type: 'audio', title: 'Intro Sound', defaultValue: 'https://media.test/intro.wav'},
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
  assert.equal(groups[0].toolTip, 'Properties of "Theme" Global View Model.\nWhen targeted via Composition Scripting, all properties must use the "Theme" prefix.\nExample: "Themecolor1"');
  assert.equal(groups[1].toolTip, 'Properties of "Main".\nWhen targeted via Composition Scripting, use each property\'s exact field ID.\nExample: "score"');
  assert.equal(groups[3].toolTip, 'Properties of "propertyOfScoreboard" nested View Model within "Live" View Model.\nWhen targeted via Composition Scripting, all properties must use the "propertyOfLivepropertyOfScoreboard" prefix.\nExample: "propertyOfLivepropertyOfScoreboardinOut"');
  const fields = new Set(x.publications[0].fields.map(field => field.id));
  assert.equal(new Set(groups.map(group => group.id)).size, groups.length);
  for (const group of groups) {
    assert.ok(group.childIds.every(id => fields.has(id)));
    const lines = group.toolTip.split('\n');
    assert.ok(lines.slice(0, -1).every(line => line.endsWith('.')));
    assert.ok(lines.at(-1).startsWith('Example: "') && lines.at(-1).endsWith('"'));
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
    referencedFontAssets: {ExampleRegular: {fieldId: 'ExampleRegular', assetName: 'Example-Regular.ttf'}},
    referencedAudioAssets: {Track: {fieldId: 'Track', assetName: 'Track.wav'}},
  });
  x.api.generateUIModel();
  const groups = x.publications[0].groups;
  assert.deepEqual(plain(groups.map(group => ({title: group.title, fields: group.childIds}))), [
    {title: 'Theme', fields: ['Themefont1']},
    {title: 'Main', fields: ['font1']},
    {title: 'propertyOfLive : Live', fields: ['propertyOfLivefont1']},
    {title: 'Fonts', fields: ['ExampleRegular']},
    {title: 'Audio', fields: ['Track']},
  ]);
  assert.equal(groups[0].toolTip, 'Properties of "Theme" Global View Model.\nWhen targeted via Composition Scripting, all properties must use the "Theme" prefix.\nExample: "Themefont1"');
  assert.equal(groups[1].toolTip, 'Properties of "Main".\nWhen targeted via Composition Scripting, use each property\'s exact field ID.\nExample: "font1"');
  assert.equal(groups[2].toolTip, 'Properties of "propertyOfLive" nested View Model within "Main" View Model.\nWhen targeted via Composition Scripting, all properties must use the "propertyOfLive" prefix.\nExample: "propertyOfLivefont1"');
  assert.equal(groups[3].toolTip, 'Font overrides for referenced text assets in the Rive file.');
  assert.equal(groups[4].toolTip, 'Audio overrides for referenced audio assets in the Rive file.');
});

test('font grouping: fonts and other nested properties share the property path prefix', () => {
  const child = model('Live', {title: field('string', ''), font1: field('font', null)});
  const x = setupViewModels(model('Main', {propertyOfLive: {type: 'viewModel', instance: child}}));
  x.api.generateUIModel();
  const group = x.publications[0].groups[0];
  assert.deepEqual(plain(group.childIds), ['propertyOfLivetitle', 'propertyOfLivefont1']);
  assert.ok(group.toolTip.includes('all properties must use the "propertyOfLive" prefix'));
  assert.ok(group.toolTip.endsWith('Example: "propertyOfLivetitle"'));
});

test('property catalog logs exact published IDs and types after UI generation, including nested/global fonts and assets', () => {
  const nested = model('Live', {titleFont: field('font', null)});
  const main = model('Main', {score: field('number', 1), titleFont: field('font', null),
    propertyOfLive: {type: 'viewModel', instance: nested}, private__: field('number', 99)});
  const x = setupViewModels(main, {Theme: model('Theme', {titleFont: field('font', null)})}, {
    referencedFontAssets: {InterRegular: {fieldId: 'InterRegular', assetName: 'Inter-Regular.ttf'}},
    referencedAudioAssets: {IntroSound: {fieldId: 'IntroSound', assetName: 'Intro Sound.wav'}},
  });
  const originalTable = x.context.console.table;
  x.context.console.table = (...args) => {
    assert.equal(x.publications.length, 1, 'The dynamic UI must be published before the catalog');
    originalTable(...args);
  };
  x.api.generateUIModel();
  assert.deepEqual(x.consoleOutput.map(entry => entry.method), ['groupCollapsed', 'table', 'groupEnd']);
  const rows = plain(x.consoleOutput[1].args[0]);
  const config = JSON.parse(fs.readFileSync(new URL('../RiveLink/source/widget_ui_config.json', import.meta.url), 'utf8')).model;
  assert.deepEqual(rows.map(row => row['Field ID']), [...config.fields, ...plain(x.publications[0].fields)].map(field => field.id));
  assert.deepEqual(rows.find(row => row['Field ID'] === 'propertyOfLivetitleFont'), {
    'Field ID': 'propertyOfLivetitleFont', 'Rive type': 'font', 'Singular control': 'metricfont',
    Scope: 'Nested', 'View Model': 'Main', 'Property / asset': 'propertyOfLive/titleFont',
  });
  assert.equal(rows.find(row => row['Field ID'] === 'ThemetitleFont').Scope, 'Global');
  assert.equal(rows.find(row => row['Field ID'] === 'ThemetitleFont')['View Model'], 'Theme');
  assert.equal(rows.find(row => row['Field ID'] === 'InterRegular')['Property / asset'], 'Inter-Regular.ttf');
  assert.equal(rows.find(row => row['Field ID'] === 'IntroSound')['Rive type'], 'audio');
  assert.ok(!rows.some(row => row['Property / asset'].includes('private')));
});

test('property catalog stays quiet for unchanged inventories and value updates, then refreshes for context or asset changes', async () => {
  const x = setupViewModels(model('Main', {score: field('number', 1)}));
  x.api.widgetState.artboardName = 'Main';
  x.api.generateUIModel();
  await x.callbacks.onValue({score: '12.5'});
  x.api.generateUIModel();
  assert.equal(x.consoleOutput.filter(entry => entry.method === 'table').length, 1);
  x.api.widgetState.referencedAudioAssets.Track = {fieldId: 'Track', assetName: 'Track.wav'};
  x.api.generateUIModel();
  assert.equal(x.consoleOutput.filter(entry => entry.method === 'table').length, 2);
  x.api.widgetState.artboardName = 'Second';
  x.api.generateUIModel();
  assert.equal(x.consoleOutput.filter(entry => entry.method === 'table').length, 3);
  assert.ok(x.consoleOutput.filter(entry => entry.method === 'groupCollapsed').at(-1).args[0].includes('Second'));
});

test('property catalog handles an empty dynamic UI and consoles without table/group support', () => {
  const x = setupViewModels(model('Main', {}));
  delete x.context.console.table;
  delete x.context.console.groupCollapsed;
  delete x.context.console.groupEnd;
  x.api.generateUIModel();
  assert.equal(x.publications.length, 1);
  const rows = plain(x.consoleOutput.find(entry => entry.method === 'log').args[1]);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.Scope === 'Widget'));
});
