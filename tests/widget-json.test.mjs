import assert from 'node:assert/strict';
import {test} from 'node:test';
import {model, field, row, list, setup, setupViewModels} from './helpers/widget-harness.mjs';

test('global color IDs use Model plus property in the UI, tooltip and runtime updates', async () => {
  const writes = [];
  const global = model('Global', {color1: {type: 'color', accessor: {value: 0xff000000, rgba: (...args) => writes.push(args)}}});
  const main = model('Main', {topicsPosX: field('number', 0)});
  const x = setupViewModels(main, {Global: global});
  let ui;
  x.sdk.setCustomWidgetUI = value => {ui = value;};
  x.api.generateUIModel();
  assert.equal(ui.fields.find(value => value.title === 'color1').id, 'Globalcolor1');
  assert.ok(ui.groups.find(value => value.title === 'Global').toolTip.includes('Example: Globalcolor1.'));
  await x.api.onSingularValue({Globalcolor1: {r: 12, g: 34, b: 56, a: 1}, topicsPosX: '3.0'});
  assert.deepEqual(writes, [[12, 34, 56, 255]]);
  assert.equal(main.number('topicsPosX').value, 3);
  assert.equal(x.errors.length, 0);
});

test('global nested property paths and View Model casing remain distinct', () => {
  const child = model('Scoreboard', {inOut: field('boolean', false)});
  const first = model('Global', {scoreboard: {type: 'viewModel', instance: child}, color1: field('number', 0)});
  const second = model('Theme', {color1: field('number', 0)});
  const x = setupViewModels(model('Main', {}), {Global: first, Theme: second});
  assert.equal(x.discovered.props['global:Global:scoreboard/inOut'].fieldId, 'GlobalscoreboardinOut');
  assert.equal(x.discovered.props['global:Global:color1'].fieldId, 'Globalcolor1');
  assert.equal(x.discovered.props['global:Theme:color1'].fieldId, 'Themecolor1');
  x.api.updateDynamicProperties({GlobalscoreboardinOut: true, Globalcolor1: '12.5', Themecolor1: '25'});
  assert.equal(child.boolean('inOut').value, true);
  assert.equal(first.number('color1').value, 12.5);
  assert.equal(second.number('color1').value, 25);
});

test('global fonts with Model plus property IDs still decode and update their bound accessor', async () => {
  const global = model('Global', {titleFont: field('font', null)});
  const x = setupViewModels(model('Main', {}), {Global: global});
  let released = 0;
  const decoded = {unref() {released++;}};
  x.fontRuntime.decodeFont = async bytes => {assert.deepEqual(Array.from(bytes), [1, 2]); return decoded;};
  x.api.fontBytesCache.set('Test Font|400|auto', Promise.resolve(new Uint8Array([1, 2])));
  assert.equal(x.discovered.props['global:Global:titleFont'].fieldId, 'GlobaltitleFont');
  await x.api.onSingularValue({GlobaltitleFont: {fontData: {family: 'Test Font', weight: '400'}}});
  assert.equal(global.font('titleFont').value, decoded);
  assert.equal(x.api.widgetState.metricFontData.GlobaltitleFont.family, 'Test Font');
  assert.equal(x.api.widgetState.pendingInitialValues.GlobaltitleFont, undefined);
  assert.equal(released, 1);
});

test('global font values received before discovery are applied after binding', async () => {
  const global = model('Global', {font: field('font', null)});
  const x = setupViewModels(model('Main', {}), {Global: global});
  const decoded = {unref() {}};
  x.fontRuntime.decodeFont = async () => decoded;
  x.api.fontBytesCache.set('Test Font|400|auto', Promise.resolve(new Uint8Array([1])));
  x.api.widgetState.riveReady = false;
  x.api.widgetState.dataBoundFontProperties = {};
  await x.api.onSingularValue({Globalfont: {fontData: {family: 'Test Font'}}});
  assert.ok(x.api.widgetState.pendingInitialValues.Globalfont);
  x.api.getAllViewModelProperties(x.runtime);
  x.api.widgetState.riveReady = true;
  await x.api.onSingularValue({...x.api.widgetState.pendingInitialValues});
  assert.equal(global.font('font').value, decoded);
  assert.equal(x.api.widgetState.pendingInitialValues.Globalfont, undefined);
});

test('font and audio prefixes cannot consume known numeric or list View Model properties', async () => {
  const rows = list([row()]);
  const global = model('rive', {audioLevel: field('number', 0), fontRows: {type: 'list', accessor: rows}});
  const x = setupViewModels(model('Main', {}), {rive: global});
  x.api.widgetState.riveReady = false;
  await x.api.onSingularValue({riveaudioLevel: 12.5, rivefontRows: {family: [{score: '12.5', title: 'updated'}]}});
  assert.equal(x.api.widgetState.pendingInitialValues.riveaudioLevel, 12.5);
  assert.ok(x.api.widgetState.pendingInitialValues.rivefontRows);
  assert.equal(x.api.widgetState.audioAssetUrls.riveaudioLevel, undefined);
  assert.equal(x.api.widgetState.metricFontData.rivefontRows, undefined);
  x.api.widgetState.riveReady = true;
  await x.api.onSingularValue({...x.api.widgetState.pendingInitialValues});
  assert.equal(global.number('audioLevel').value, 12.5);
  assert.equal(rows.instanceAt(0).number('score').value, 12.5);
  assert.equal(rows.instanceAt(0).string('title').value, 'updated');
});

test('prefixed global values survive startup before their property metadata is available', async () => {
  const rows = list([row()]);
  const global = model('rive', {audioLevel: field('number', 0), fontRows: {type: 'list', accessor: rows}});
  const x = setupViewModels(model('Main', {}), {rive: global});
  x.api.widgetState.riveReady = false;
  x.api.widgetState.riveProps = {};
  await x.api.onSingularValue({riveaudioLevel: 12.5, rivefontRows: {family: [{score: '12.5'}]}});
  assert.equal(x.api.widgetState.pendingInitialValues.riveaudioLevel, 12.5);
  assert.ok(x.api.widgetState.pendingInitialValues.rivefontRows);
  assert.equal(x.api.widgetState.metricFontData.rivefontRows, undefined);
  x.api.widgetState.riveProps = x.api.getAllViewModelProperties(x.runtime).props;
  x.api.widgetState.riveReady = true;
  await x.api.onSingularValue({...x.api.widgetState.pendingInitialValues});
  assert.equal(global.number('audioLevel').value, 12.5);
  assert.equal(rows.instanceAt(0).number('score').value, 12.5);
});

test('referenced fonts, normal bound fonts and audio controls keep their existing routing', async () => {
  const fonts = [];
  const main = model('Main', {titleFont: field('font', null)});
  const x = setupViewModels(main, {}, {
    referencedFontAssets: {rivefontInter: {fieldId: 'rivefontInter', asset: {setFont(value) {fonts.push(value);}}}},
    referencedAudioAssets: {riveaudioMusic: {fieldId: 'riveaudioMusic', asset: {}}},
  });
  let decoded = 0, released = 0;
  x.fontRuntime.decodeFont = async () => ({id: ++decoded, unref() {released++;}});
  x.api.fontBytesCache.set('Test Font|400|auto', Promise.resolve(new Uint8Array([1])));
  await x.api.onSingularValue({
    rivefontInter: {fontData: {family: 'Test Font'}},
    rivefontproptitleFont: {fontData: {family: 'Test Font'}},
    riveaudioMusic: {url: 'https://example.com/music.mp3'},
  });
  assert.equal(fonts.length, 1);
  assert.ok(main.font('titleFont').value);
  assert.equal(decoded, 2);
  assert.equal(released, 2);
  assert.equal(x.api.widgetState.audioAssetUrls.riveaudioMusic, 'https://example.com/music.mp3');
  assert.equal(x.api.widgetState.pendingInitialValues.rivefontInter, undefined);
  assert.equal(x.api.widgetState.pendingInitialValues.rivefontproptitleFont, undefined);
  assert.equal(x.api.widgetState.pendingInitialValues.riveaudioMusic, undefined);
});

test('font and audio startup data remain cached until asset discovery', async () => {
  const x = setupViewModels(model('Main', {}), {});
  x.api.widgetState.riveReady = false;
  await x.api.onSingularValue({rivefontInter: {fontData: {family: 'Test Font'}}, riveaudioMusic: 'https://example.com/music.mp3'});
  assert.equal(x.api.widgetState.metricFontData.rivefontInter.family, 'Test Font');
  assert.equal(x.api.widgetState.audioAssetUrls.riveaudioMusic, 'https://example.com/music.mp3');
  assert.ok(x.api.widgetState.pendingInitialValues.rivefontInter);
  assert.ok(x.api.widgetState.pendingInitialValues.riveaudioMusic);
  x.api.widgetState.referencedFontAssets.rivefontInter = {asset: {}};
  x.api.widgetState.referencedAudioAssets.riveaudioMusic = {asset: {}};
  x.api.widgetState.riveReady = true;
  await x.api.onSingularValue({...x.api.widgetState.pendingInitialValues});
  assert.equal(x.api.widgetState.pendingInitialValues.rivefontInter, undefined);
  assert.equal(x.api.widgetState.pendingInitialValues.riveaudioMusic, undefined);
});

test('a global ID collision preserves the existing Main control and reports the omitted global', () => {
  const main = model('Main', {Globalcolor1: field('number', 1)});
  const global = model('Global', {color1: field('number', 2)});
  const x = setupViewModels(main, {Global: global});
  assert.equal(x.discovered.props.Globalcolor1.fieldId, 'Globalcolor1');
  assert.equal(x.discovered.props['global:Global:color1'], undefined);
  assert.equal(x.errors.length, 1);
  assert.equal(x.errors[0][1].fieldId, 'Globalcolor1');
  x.api.updateDynamicProperties({Globalcolor1: 10});
  assert.equal(main.number('Globalcolor1').value, 10);
  assert.equal(global.number('color1').value, 2);
});

test('ambiguous Model plus property names and sanitized names are reported without hashes', () => {
  const globals = {
    AB: model('AB', {c: field('number', 0)}),
    A: model('A', {Bc: field('number', 0)}),
    Global: model('Global', {'score value': field('number', 0), 'score-value': field('number', 0), count: field('number', 0)}),
  };
  const x = setupViewModels(model('Main', {}), globals);
  assert.deepEqual(Object.keys(x.discovered.props), ['global:Global:count']);
  assert.equal(x.discovered.props['global:Global:count'].fieldId, 'Globalcount');
  assert.equal(x.errors.length, 4);
});

test('global IDs cannot replace configuration or referenced asset controls', () => {
  const globals = {
    rive: model('rive', {artboard: field('number', 0)}),
    rivefont: model('rivefont', {Inter: field('number', 0)}),
    riveaudio: model('riveaudio', {Music: field('number', 0)}),
  };
  const x = setupViewModels(model('Main', {}), globals, {
    referencedFontAssets: {font: {fieldId: 'rivefontInter'}},
    referencedAudioAssets: {audio: {fieldId: 'riveaudioMusic'}},
  });
  assert.equal(Object.keys(x.discovered.props).length, 0);
  assert.equal(x.errors.length, 3);
});

test('adding globals does not rename existing disambiguated Main IDs', () => {
  const main = model('Main', {'score value': field('number', 0), 'score-value': field('number', 0)});
  const before = setupViewModels(main, {}).discovered.props;
  const x = setupViewModels(main, {Global: model('Global', {color1: field('number', 0)})});
  assert.equal(x.discovered.props['score value'].fieldId, before['score value'].fieldId);
  assert.equal(x.discovered.props['score-value'].fieldId, before['score-value'].fieldId);
});

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

test('editing decimals updates Rive without republishing or rewriting the Singular UI', async () => {
  const x = setup();
  x.api.widgetState.riveReady = true;
  x.api.widgetState.defaultVMName = 'Root';
  const score = field('number', 5);
  x.api.widgetState.riveProps = {score: {type: 'number', accessor: score.accessor, propertyName: 'score', parentPath: '', vmName: 'Root'}};
  let uiPublications = 0;
  x.sdk.setCustomWidgetUI = () => {uiPublications++; return {success: true};};
  x.api.generateUIModel();
  assert.equal(uiPublications, 1);
  for (const value of ['12', '12.', '12.5', 12.5, '-0.125']) await x.api.onSingularValue({score: value});
  assert.equal(score.accessor.value, -0.125);
  assert.equal(uiPublications, 1);
});

test('small decimals arriving in JavaScript exponential notation remain numbers', () => {
  const x = setup();
  for (const value of [0.0000001, '0.0000001', String(0.0000001), '-1.25e-7', '1.25E+3']) {
    const normalized = x.apply([{score: value}]);
    assert.equal(normalized[0].score, Number(value));
    assert.equal(x.rows.instanceAt(0).number('score').value, Number(value));
  }
});

test('normalized list JSON contains numbers and preserves numeric text and the caller payload', () => {
  const x = setup();
  const incoming = [{score: '25', title: '0012', size__: '10', unknown: '25'}];
  const normalized = x.apply(incoming);
  assert.equal(normalized[0].score, 25);
  assert.equal(normalized[0].title, '0012');
  assert.equal(normalized[0].size__, 10);
  assert.equal(normalized[0].unknown, '25');
  assert.equal(incoming[0].score, '25');
  assert.equal(incoming[0].size__, '10');
  assert.equal(x.rows.instanceAt(0).number('size__').value, 24);
  assert.equal(JSON.parse(x.prop._lastListData)[0].score, 25);
  x.apply(normalized);
  x.apply(incoming);
  assert.equal(x.plays.length, 1);
});

test('numeric JSON normalization preserves arrays, table wrappers, and single-row shapes', () => {
  for (const input of [[{score: '25'}], {table: [{score: '25'}]}, {score: '25'}]) {
    for (const encoded of [false, true]) {
      const x = setup();
      const normalized = x.apply(encoded ? JSON.stringify(input) : input);
      const value = encoded ? JSON.parse(normalized) : normalized;
      if (Array.isArray(input)) assert.equal(value[0].score, 25);
      else if (input.table) assert.equal(value.table[0].score, 25);
      else assert.equal(value.score, 25);
    }
  }
  const x = setup();
  const alreadyNumeric = '[ { "score": 25 } ]';
  assert.equal(x.apply(alreadyNumeric), alreadyNumeric);
});

test('new and replacement rows normalize using their declared model and release schema templates', () => {
  const x = setup([]);
  const profile = () => model('Profile', {size: field('number', 12), label: field('string', '')});
  let released = 0;
  x.definitions.set('NumericRow', {properties: [{name: 'profile', type: 'viewModel'}], defaultInstance() {
    const result = model('NumericRow', {profile: {type: 'viewModel', instance: profile()}});
    result.cleanup = () => released++;
    return result;
  }});
  const payload = [{_vm: 'NumericRow', profile: {size: '25', label: '025'}}];
  const normalized = x.apply(payload);
  assert.equal(normalized[0].profile.size, 25);
  assert.equal(normalized[0].profile.label, '025');
  assert.equal(payload[0].profile.size, '25');
  assert.equal(x.rows.instanceAt(0).viewModel('profile').number('size').value, 25);
  assert.equal(released, 1);
  x.apply([{_vm: 'Row', score: '2a91'}]);
  assert.equal(JSON.parse(x.prop._lastListData)[0].score, 0);
});

test('keyed reordering uses the correct numeric schema for heterogeneous rows', () => {
  const numeric = model('NumericRow', {id: field('string', 'number'), value: field('number', 1)});
  const text = model('TextRow', {id: field('string', 'text'), value: field('string', '0012')});
  const x = setup([numeric, text]);
  x.apply([{id: 'number', value: '25'}, {id: 'text', value: '0012'}]);
  const normalized = x.apply([{id: 'text', value: '0025'}, {id: 'number', value: '26'}]);
  assert.equal(normalized[0].value, '0025');
  assert.equal(normalized[1].value, 26);
  assert.equal(x.rows.instanceAt(0), text);
  assert.equal(text.string('value').value, '0025');
  assert.equal(numeric.number('value').value, 26);
});

test('the widget keeps numeric JSON internally without writing back to Singular or changing the input', async () => {
  const x = setup();
  x.api.widgetState.riveReady = true;
  const score = field('number', 5);
  x.api.widgetState.riveProps = {rows: x.prop, score: {type: 'number', accessor: score.accessor}};
  x.sdk.setCustomWidgetUI = () => assert.fail('Value updates must not republish the UI');
  const original = {rows: '[{"score":"12.375","title":"0012"}]', score: '3.0', other: '25'};
  await x.api.onSingularValue(original);
  assert.equal(x.api.widgetState.pendingInitialValues.score, 3);
  const savedRows = JSON.parse(x.api.widgetState.pendingInitialValues.rows);
  assert.equal(savedRows[0].score, 12.375);
  assert.equal(savedRows[0].title, '0012');
  assert.equal(x.api.widgetState.pendingInitialValues.other, '25');
  assert.equal(score.accessor.value, 3);
  assert.equal(x.rows.instanceAt(0).number('score').value, 12.375);
  assert.equal(original.score, '3.0');
  assert.equal(JSON.parse(original.rows)[0].score, '12.375');
  await x.api.onSingularValue(original);
  assert.equal(x.plays.length, 1);
});

test('numeric normalization does not restore consumed font keys to pending initial values', async () => {
  const x = setup();
  x.api.widgetState.riveReady = true;
  const score = field('number', 5);
  x.api.widgetState.riveProps = {score: {type: 'number', accessor: score.accessor}};
  await x.api.onSingularValue({score: '25', rivefontExample: {fontData: {family: 'Inter', weight: '400'}}});
  assert.equal(x.api.widgetState.pendingInitialValues.score, 25);
  assert.equal(x.api.widgetState.pendingInitialValues.rivefontExample, undefined);
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

test('invalid numeric values reset the number to zero without partial parsing', () => {
  const x = setup();
  for (const value of ['', '   ', null, false, true, 'aaaa', '2a91', '12px', '12,5', '0x19', '1e', '1e+', '1e2x', '1..2', Infinity, -Infinity, NaN, 'Infinity', [], {}]) {
    x.apply([{score: 19}]);
    x.apply([{score: value}]);
    assert.equal(x.rows.instanceAt(0).number('score').value, 0);
  }
  assert.equal(x.warnings.length, 0);
});

test('decimal strings retain signs, fractions, whitespace, and leading zeros', () => {
  const x = setup();
  for (const [value, expected] of [['25', 25], ['3.0', 3], [3.125, 3.125], ['  -12.5  ', -12.5], ['+25', 25], ['.5', 0.5], ['1.', 1], ['0012', 12], [0.25, 0.25], ['2e3', 2000]]) {
    x.apply([{score: value}]);
    assert.equal(x.rows.instanceAt(0).number('score').value, expected);
  }
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
  x.api.updateDynamicProperties({score: ''}); assert.equal(number.accessor.value, 0);
  x.api.updateDynamicProperties({score: '25'}); assert.equal(number.accessor.value, 25);
  x.api.updateDynamicProperties({score: '2a91'}); assert.equal(number.accessor.value, 0);
  x.api.updateDynamicProperties({score: '25'});
  x.api.updateDynamicProperties({visible: true}); assert.equal(number.accessor.value, 25);
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
  x.apply([{mode: 'Timer', profile: {score: '2a91'}}]);
  assert.equal(nested.number('score').value, 0);
  x.apply([{mode: 'unknown option'}]); assert.equal(entry.enum('mode').value, 'Timer');
  assert.equal(x.warnings.length, 1);
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
