import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bytesResponse, createHarness, deferred, field, flushAsync, model, setup, setupViewModels} from './helpers/widget-harness.mjs';

test('fonts: Google API weight selection upgrades HTTP font URLs to HTTPS', async () => {
  const x = createHarness(), requests = [];
  x.context.fetch = async url => {
    requests.push(url);
    return requests.length === 1
      ? {ok: true, json: async () => ({items: [{files: {regular: 'http://fonts.test/regular.ttf', 700: 'http://fonts.test/bold.ttf'}}]})}
      : bytesResponse([7, 0, 0]);
  };
  const bytes = await x.api.resolveFontBytes({family: 'Example Family', weight: 700});
  assert.match(requests[0], /family=Example%20Family/);
  assert.equal(requests[1], 'https://fonts.test/bold.ttf');
  assert.deepEqual([...bytes], [7, 0, 0]);
});

test('fonts: unavailable API falls back to the matching GitHub static font', async () => {
  const x = createHarness(), requests = [];
  x.context.fetch = async url => {
    requests.push(url);
    return url.endsWith('/static/ExampleFamily-Bold.ttf') ? bytesResponse([7]) : {ok: false};
  };
  assert.deepEqual([...await x.api.resolveFontBytes({family: 'Example Family', weight: '700'})], [7]);
  assert.ok(requests.includes('https://raw.githubusercontent.com/google/fonts/main/ofl/examplefamily/static/ExampleFamily-Bold.ttf'));
});

test('fonts: Inter fallback is shared when neither API nor GitHub has the family', async () => {
  const x = createHarness(), requests = [];
  x.context.fetch = async url => {
    requests.push(url);
    return url === 'https://cdn.rive.app/runtime/flutter/inter.ttf' ? bytesResponse([9]) : {ok: false};
  };
  for (const family of ['Missing One', 'Missing Two']) {
    assert.deepEqual([...await x.api.resolveFontBytes({family})], [9]);
  }
  assert.equal(requests.filter(url => url.endsWith('/inter.ttf')).length, 1);
});

test('fonts: concurrent requests share bytes but callers receive independent buffers', async () => {
  const x = createHarness(), gate = deferred();
  let requests = 0;
  x.context.fetch = async () => {
    requests++;
    await gate.promise;
    return requests === 1
      ? {ok: true, json: async () => ({items: [{files: {regular: 'https://fonts.test/a.ttf'}}]})}
      : bytesResponse([1, 2]);
  };
  const a = x.api.resolveFontBytes({family: 'Example'}), b = x.api.resolveFontBytes({family: 'Example', weight: '400', subset: 'auto'});
  gate.resolve();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(requests, 2);
  first[0] = 99;
  assert.equal(second[0], 1);
  assert.equal((await x.api.resolveFontBytes({family: 'Example'}))[0], 1);
});

test('fonts: failed requests are evicted so the same selection can be retried', async () => {
  const x = createHarness();
  x.context.fetch = async () => ({ok: false});
  await assert.rejects(x.api.resolveFontBytes({family: 'Retry'}), /Fallback font request failed/);
  assert.equal(x.api.fontBytesCache.size, 0);
  x.context.fetch = async url => url.endsWith('/inter.ttf') ? bytesResponse([4]) : {ok: false};
  assert.deepEqual([...await x.api.resolveFontBytes({family: 'Retry'})], [4]);
});

test('fonts: latest selection wins even when the previous decode finishes later', async () => {
  const main = model('Main', {font: field('font', null)}), x = setupViewModels(main);
  const first = deferred(), second = deferred(), applied = [], released = [];
  x.api.fontBytesCache.set('First|400|auto', Promise.resolve(Uint8Array.of(1)));
  x.api.fontBytesCache.set('Second|400|auto', Promise.resolve(Uint8Array.of(2)));
  x.fontRuntime.decodeFont = bytes => bytes[0] === 1 ? first.promise : second.promise;
  const a = x.api.onSingularValue({font: {fontData: {family: 'First'}}});
  await flushAsync();
  const b = x.api.onSingularValue({font: {fontData: {family: 'Second'}}});
  await flushAsync();
  const secondFont = {unref() {released.push('second');}};
  second.resolve(secondFont); await b;
  applied.push(main.font('font').value);
  first.resolve({unref() {released.push('first');}}); await a;
  assert.equal(main.font('font').value, secondFont);
  assert.deepEqual(applied, [secondFont]);
  assert.deepEqual(released, ['second', 'first']);
});

test('fonts: a reload cannot receive a decoded font intended for the previous accessor', async () => {
  const x = setupViewModels(model('Main', {font: field('font', null)})), gate = deferred();
  const old = x.runtime.viewModelInstance.font('font');
  let released = 0;
  x.api.fontBytesCache.set('Example|400|auto', gate.promise);
  x.fontRuntime.decodeFont = async () => ({unref() {released++;}});
  const apply = x.api.onSingularValue({font: {family: 'Example'}});
  x.api.widgetState.dataBoundFontProperties = {font: {accessor: {value: 'new instance'}}};
  gate.resolve(Uint8Array.of(1)); await apply;
  assert.equal(old.value, null);
  assert.equal(x.api.widgetState.dataBoundFontProperties.font.accessor.value, 'new instance');
  assert.equal(released, 1);
});

test('fonts: identical selections do not decode again or reload the animation', async () => {
  const x = setupViewModels(model('Main', {font: field('font', null)}));
  let decodes = 0;
  x.api.widgetState.fileUrl = 'https://files.test/a.riv';
  x.api.fontBytesCache.set('Example|400|auto', Promise.resolve(Uint8Array.of(1)));
  x.fontRuntime.decodeFont = async () => {decodes++; return {unref() {}};};
  const payload = {font: {fontData: {family: 'Example', weight: 400}}};
  await x.api.onSingularValue(payload); await x.api.onSingularValue(payload);
  assert.equal(decodes, 1);
  assert.equal(x.api.widgetState.r, x.runtime);
  assert.equal(x.publications.length, 0);
});

for (const failure of ['throw', 'null']) {
  test(`fonts: ${failure} decode preserves the authored font`, async () => {
    const authored = {}, x = setupViewModels(model('Main', {font: field('font', authored)}));
    x.api.fontBytesCache.set('Example|400|auto', Promise.resolve(Uint8Array.of(1)));
    x.fontRuntime.decodeFont = async () => {if (failure === 'throw') throw Error('bad font'); return null;};
    await x.api.onSingularValue({font: {family: 'Example'}});
    assert.equal(x.runtime.viewModelInstance.font('font').value, authored);
  });
}

test('fonts: glyph fallback retains its wrapper until runtime teardown', async () => {
  const x = createHarness(), callbacks = [];
  let decodes = 0, released = 0;
  const font = {unref() {released++;}};
  x.context.fetch = async () => bytesResponse();
  x.fontRuntime.decodeFont = async () => {decodes++; return font;};
  x.fontRuntime.RiveFont = {setFallbackFontCallback(callback) {callbacks.push(callback);}};
  await x.api.prepareRiveGlyphFallbackFonts();
  await x.api.prepareRiveGlyphFallbackFonts();
  assert.deepEqual([...callbacks.at(-1)()], [font]);
  assert.equal(decodes, 1); assert.equal(released, 0);
  x.api.releaseRiveGlyphFallbackFonts();
  assert.equal(callbacks.at(-1), null); assert.equal(released, 1);
  assert.equal(x.api.widgetState.fallbackFontWrappers.length, 0);
});

test('fonts: failed asset assignment still releases the decoded wrapper', async () => {
  const x = setup(); let released = 0;
  x.api.widgetState.referencedFontAssets.ExampleRegular = {asset: {setFont() {throw Error('asset disposed');}}};
  x.api.widgetState.metricFontData.ExampleRegular = {family: 'Example'};
  x.api.fontBytesCache.set('Example|400|auto', Promise.resolve(Uint8Array.of(1)));
  x.fontRuntime.decodeFont = async () => ({unref() {released++;}});
  await x.api.fetchAndApplyFont('ExampleRegular');
  assert.equal(released, 1);
});

test('fonts: unsupported glyph fallback APIs leave the runtime usable without a network request', async () => {
  const x = createHarness();
  x.context.fetch = () => assert.fail('unsupported runtimes must not fetch fallback fonts');
  await x.api.prepareRiveGlyphFallbackFonts();
  assert.equal(x.api.widgetState.fallbackFontWrappers.length, 0);
});

test('fonts: family, weight and subset selections have independent cache entries', async () => {
  const x = createHarness();
  const inputs = [{family: 'Example', weight: '400'}, {family: 'Example', weight: '700'},
    {family: 'Example', weight: '400', subset: 'latin'}, {family: 'Other', weight: '400'}];
  x.context.fetch = async url => url.includes('googleapis.com')
    ? {ok: true, json: async () => ({items: [{files: {regular: 'https://fonts.test/a.ttf'}}]})}
    : bytesResponse();
  await Promise.all(inputs.map(value => x.api.resolveFontBytes(value)));
  assert.deepEqual([...x.api.fontBytesCache.keys()].sort(), ['Example|400|auto', 'Example|400|latin', 'Example|700|auto', 'Other|400|auto']);
});

test('audio: prefetched audio is reused for applies and released once during teardown', async () => {
  const x = setup(), applied = [];
  let requests = 0, decodes = 0, released = 0;
  const decoded = {unref() {released++;}};
  x.context.fetch = async url => {assert.equal(url, 'https://media.test/a.mp3'); requests++; return bytesResponse();};
  x.fontRuntime.decodeAudio = async () => {decodes++; return decoded;};
  x.api.widgetState.audioAssetUrls = {Music: '//media.test/a.mp3'};
  x.api.widgetState.referencedAudioAssets = {Music: {asset: {setAudioSource: value => applied.push(value)}}};
  await x.api.prefetchAudioAssets(); await x.api.prefetchAudioAssets();
  await x.api.fetchAndApplyAudio('Music');
  assert.deepEqual(applied, [decoded]);
  assert.equal(requests, 1); assert.equal(decodes, 1); assert.equal(released, 0);
  x.api.releaseDecodedAudioCache(); x.api.releaseDecodedAudioCache();
  assert.equal(released, 1); assert.equal(Object.keys(x.api.audioDecodedCache).length, 0);
});

for (const failure of ['http', 'fetch', 'decode', 'null']) {
  test(`audio: ${failure} failure keeps the authored source and permits retry`, async () => {
    const x = setup(), applied = [];
    x.api.widgetState.audioAssetUrls = {Music: 'media.test/a.mp3'};
    x.api.widgetState.referencedAudioAssets = {Music: {asset: {setAudioSource: value => applied.push(value)}}};
    x.context.fetch = async () => {if (failure === 'fetch') throw Error('offline'); return failure === 'http' ? {ok: false} : bytesResponse();};
    x.fontRuntime.decodeAudio = async () => {if (failure === 'decode') throw Error('bad audio'); return null;};
    await x.api.fetchAndApplyAudio('Music');
    assert.equal(applied.length, 0); assert.equal(Object.keys(x.api.audioDecodedCache).length, 0);
    x.context.fetch = async () => bytesResponse();
    const decoded = {unref() {}};
    x.fontRuntime.decodeAudio = async () => decoded;
    await x.api.fetchAndApplyAudio('Music');
    assert.deepEqual(applied, [decoded]);
  });
}

test('audio: a replaced asset cannot receive a late decode', async () => {
  const x = setup(), gate = deferred(), applied = [];
  x.api.widgetState.audioAssetUrls = {Music: 'https://media.test/a.mp3'};
  x.api.widgetState.referencedAudioAssets = {Music: {asset: {setAudioSource: () => applied.push('old')}}};
  x.context.fetch = async () => bytesResponse();
  x.fontRuntime.decodeAudio = () => gate.promise;
  const pending = x.api.fetchAndApplyAudio('Music');
  await flushAsync();
  x.api.widgetState.referencedAudioAssets.Music.asset = {setAudioSource: () => applied.push('new')};
  gate.resolve({unref() {}}); await pending;
  assert.deepEqual(applied, []); assert.equal(x.warnings.length, 0);
});

for (const [kind, value] of [
  ['string', 'https://media.test/a.mp3'], ['url', {url: 'https://media.test/a.mp3'}],
  ['src', {src: 'https://media.test/a.mp3'}], ['audio', {audio: 'https://media.test/a.mp3'}],
  ['file', {file: 'https://media.test/a.mp3'}], ['empty', null],
]) {
  test(`audio: Singular ${kind} payload is routed without leaking into property updates`, async () => {
    const x = setup(); x.api.widgetState.riveReady = true;
    x.api.widgetState.referencedAudioAssets.Music = {asset: {}};
    await x.api.onSingularValue({Music: value});
    assert.equal(x.api.widgetState.audioAssetUrls.Music, value ? 'https://media.test/a.mp3' : '');
    assert.equal(x.api.widgetState.pendingInitialValues.Music, undefined);
  });
}

function imageFixture() {
  const authored = {}, image = field('image', authored);
  const x = setupViewModels(model('Main', {photo: image}));
  const prop = x.discovered.props.photo;
  return {x, prop, authored, accessor: image.accessor};
}

test('images: URL normalization, decode, assignment and play work even if already playing', async () => {
  const {x, prop, accessor} = imageFixture(), requests = [], decoded = {};
  x.runtime.isPlaying = true;
  x.context.fetch = async url => {requests.push(url); return bytesResponse([7]);};
  x.fontRuntime.decodeImage = async bytes => {assert.deepEqual([...bytes], [7]); return decoded;};
  await x.api.handleImageUpdate('photo', prop, '//media.test/a.png');
  assert.deepEqual(requests, ['https://media.test/a.png']);
  assert.equal(accessor.value, decoded); assert.deepEqual(x.plays, ['Machine']);
  await x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
  assert.equal(requests.length, 1); assert.equal(x.plays.length, 1);
});

test('images: out-of-order responses cannot overwrite the newest image', async () => {
  const {x, prop, accessor} = imageFixture(), first = deferred(), second = deferred();
  x.context.fetch = url => url.endsWith('a.png') ? first.promise : second.promise;
  x.fontRuntime.decodeImage = async bytes => ({id: bytes[0]});
  const a = x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
  const b = x.api.handleImageUpdate('photo', prop, 'https://media.test/b.png');
  second.resolve(bytesResponse([2])); await b;
  first.resolve(bytesResponse([1])); await a;
  assert.equal(accessor.value.id, 2); assert.equal(x.plays.length, 1);
  assert.equal(prop.currentImageUrl, 'https://media.test/b.png');
});

test('images: reselecting the applied URL cancels a different pending image', async () => {
  const {x, prop, accessor} = imageFixture(), gate = deferred(), original = {};
  x.context.fetch = async () => bytesResponse(); x.fontRuntime.decodeImage = async () => original;
  await x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
  x.context.fetch = () => gate.promise;
  const pending = x.api.handleImageUpdate('photo', prop, 'https://media.test/b.png');
  await x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
  gate.resolve(bytesResponse()); await pending;
  assert.equal(accessor.value, original); assert.equal(prop.pendingImageUrl, null);
  assert.equal(x.plays.length, 1);
});

test('images: duplicate pending URLs share a request and stale instances receive no assignment', async () => {
  const {x, prop, accessor, authored} = imageFixture(), gate = deferred(); let requests = 0;
  x.context.fetch = async () => {requests++; return gate.promise;};
  x.fontRuntime.decodeImage = async () => ({});
  const pending = x.api.handleImageUpdate('photo', prop, 'media.test/a.png');
  await x.api.handleImageUpdate('photo', prop, 'media.test/a.png');
  x.api.widgetState.r = {play() {assert.fail('stale image resumed a new instance');}};
  gate.resolve(bytesResponse()); await pending;
  assert.equal(requests, 1); assert.equal(accessor.value, authored); assert.equal(x.plays.length, 0);
});

for (const failure of ['http', 'fetch', 'decode', 'null']) {
  test(`images: ${failure} failure preserves the previous picture and allows retry`, async () => {
    const {x, prop, accessor, authored} = imageFixture();
    x.context.fetch = async () => {if (failure === 'fetch') throw Error('offline'); return failure === 'http' ? {ok: false, status: 404} : bytesResponse();};
    x.fontRuntime.decodeImage = async () => {if (failure === 'decode') throw Error('bad image'); return null;};
    await x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
    assert.equal(accessor.value, authored); assert.equal(prop.pendingImageUrl, null);
    assert.equal(x.warnings.length, 1); assert.equal(x.plays.length, 0);
    const decoded = {}; x.context.fetch = async () => bytesResponse(); x.fontRuntime.decodeImage = async () => decoded;
    await x.api.handleImageUpdate('photo', prop, 'https://media.test/a.png');
    assert.equal(accessor.value, decoded); assert.equal(x.plays.length, 1);
  });
}

test('images: empty values keep the authored image without fetching or playing', async () => {
  const {x, prop, accessor, authored} = imageFixture();
  for (const value of ['', null, undefined]) await x.api.handleImageUpdate('photo', prop, value);
  assert.equal(accessor.value, authored); assert.equal(x.plays.length, 0); assert.equal(x.warnings.length, 0);
});

test('JSON images: initial assignment fills both slots; a change fills previous/new slots and fires the fade trigger', async () => {
  let triggers = 0;
  const entry = model('Row', {id: field('string', 'a'), photo: field('image', null), photo__: field('image', null),
    photoUpdate__: {type: 'trigger', accessor: {trigger() {triggers++;}}}});
  const x = setup([entry]);
  x.context.fetch = async url => bytesResponse([url.endsWith('a.png') ? 1 : 2]);
  x.fontRuntime.decodeImage = async bytes => ({id: bytes[0]});
  x.apply([{id: 'a', photo: 'https://media.test/a.png'}]); await flushAsync();
  assert.equal(entry.image('photo').value, entry.image('photo__').value); assert.equal(triggers, 0);
  x.apply([{id: 'a', photo: 'https://media.test/b.png'}]); await flushAsync();
  assert.equal(entry.image('photo__').value.id, 1); assert.equal(entry.image('photo').value.id, 2);
  assert.equal(triggers, 1);
  x.apply([{id: 'a', photo: 'https://media.test/b.png'}]); await flushAsync();
  assert.equal(triggers, 1);
  assert.equal(x.plays.length, 4); // Two list updates and their two completed image assignments.
});

test('JSON images: invalid URLs are reported while unrelated row fields still apply', () => {
  const entry = model('Row', {title: field('string', 'old'), photo: field('image', null)}), x = setup([entry]);
  x.apply([{title: 'updated', photo: {url: 'unsupported object'}}]);
  assert.equal(entry.string('title').value, 'updated'); assert.equal(entry.image('photo').value, null);
  assert.equal(x.warnings.length, 1);
  assert.equal(x.warnings[0][1].properties[0].path, 'rows/0/photo');
});

// Rive's instanceAt() returns new JS wrappers around the same native row.
function useNativeAliases(rows) {
  const instanceAt = rows.instanceAt.bind(rows);
  rows.instanceAt = index => Object.create(instanceAt(index));
}

test('JSON images: scalar edits and native list reorders preserve unchanged pictures', async () => {
  const entries = ['a', 'b'].map(id => model('Row', {
    id: field('string', id), score: field('number', 0), photo: field('image', null),
  }));
  const x = setup(entries);
  useNativeAliases(x.rows);
  let requests = 0;
  x.context.fetch = async () => {requests++; return bytesResponse();};
  x.fontRuntime.decodeImage = async () => ({});
  const items = entries.map(entry => ({id: entry.string('id').value, score: 0, photo: `https://media.test/${entry.string('id').value}.png`}));
  x.apply(items); await flushAsync();
  const pictures = entries.map(entry => entry.image('photo').value);
  x.apply(items.map((item, i) => ({...item, score: i + 1}))); await flushAsync();
  x.rows.rows.reverse(); // An authored Rive sort can reorder the native list.
  x.apply([...items].reverse().map(item => ({...item, score: 5}))); await flushAsync();
  assert.equal(requests, 2);
  entries.forEach((entry, i) => assert.equal(entry.image('photo').value, pictures[i]));
  assert.equal(entries[0].number('score').value, 5);
  assert.equal(entries[1].number('score').value, 5);
});

test('JSON images: nested native aliases retain image state while edited siblings update', async () => {
  const profile = model('Profile', {photo: field('image', null), title: field('string', '')});
  let child = profile;
  const entry = model('Row', {id: field('string', 'a'), profile: {type: 'viewModel', instance: profile}});
  entry.viewModel = key => key === 'profile' ? Object.create(child) : null;
  const x = setup([entry]);
  let requests = 0;
  x.context.fetch = async () => {requests++; return bytesResponse();};
  x.fontRuntime.decodeImage = async () => ({});
  x.apply([{id: 'a', profile: {title: 'first', photo: 'https://media.test/a.png'}}]); await flushAsync();
  const picture = profile.image('photo').value;
  x.apply([{id: 'a', profile: {title: 'second', photo: 'https://media.test/a.png'}}]); await flushAsync();
  assert.equal(requests, 1);
  assert.equal(profile.image('photo').value, picture);
  assert.equal(profile.string('title').value, 'second');
  child = model('Profile', {photo: field('image', null), title: field('string', '')});
  x.apply([{id: 'a', profile: {title: 'replacement', photo: 'https://media.test/a.png'}}]); await flushAsync();
  assert.equal(requests, 2);
  assert.ok(child.image('photo').value);
  assert.equal(child.string('title').value, 'replacement');
});

test('JSON images: repeated table edits share pending loads and newer selections win', async () => {
  const entry = model('Row', {id: field('string', 'a'), score: field('number', 0), photo: field('image', null)});
  const x = setup([entry]), first = deferred(), second = deferred();
  let requests = 0;
  x.context.fetch = url => {requests++; return url.endsWith('a.png') ? first.promise : second.promise;};
  x.fontRuntime.decodeImage = async bytes => ({id: bytes[0]});
  x.apply([{id: 'a', score: 0, photo: 'https://media.test/a.png'}]);
  x.apply([{id: 'a', score: 1, photo: 'https://media.test/a.png'}]);
  x.apply([{id: 'a', score: 2, photo: 'https://media.test/b.png'}]);
  second.resolve(bytesResponse([2])); await flushAsync();
  first.resolve(bytesResponse([1])); await flushAsync();
  assert.equal(requests, 2);
  assert.equal(entry.image('photo').value.id, 2);
});

test('JSON images: matching row IDs in separate lists do not share previous-image history', async () => {
  let triggers = 0;
  const entries = [0, 1].map(() => model('Row', {id: field('string', 'same'), photo: field('image', null),
    photoUpdate__: {type: 'trigger', accessor: {trigger() {triggers++;}}}}));
  const x = setup(entries);
  x.context.fetch = async () => bytesResponse();
  x.fontRuntime.decodeImage = async () => ({});
  x.api.applyImageProperty(entries[0], 'photo', 'https://media.test/a.png', {id: 'same'}); await flushAsync();
  x.api.applyImageProperty(entries[1], 'photo', 'https://media.test/b.png', {id: 'same'}); await flushAsync();
  assert.ok(entries[1].image('photo').value);
  assert.equal(triggers, 0);
  assert.equal(x.plays.length, 2);
});

test('JSON images: reselecting the applied URL cancels a pending replacement', async () => {
  const entry = model('Row', {photo: field('image', null)}), x = setup([entry]), gate = deferred();
  x.context.fetch = async () => bytesResponse([1]);
  x.fontRuntime.decodeImage = async bytes => ({id: bytes[0]});
  await x.api.applyImageProperty(entry, 'photo', 'https://media.test/a.png');
  const original = entry.image('photo').value;
  x.context.fetch = () => gate.promise;
  const pending = x.api.applyImageProperty(entry, 'photo', 'https://media.test/b.png');
  await x.api.applyImageProperty(entry, 'photo', 'https://media.test/a.png');
  gate.resolve(bytesResponse([2])); await pending;
  assert.equal(entry.image('photo').value, original);
  assert.equal(x.plays.length, 1);
});

test('JSON images: failures preserve the picture, warn and allow a retry', async () => {
  const authored = {}, entry = model('Row', {photo: field('image', authored)}), x = setup([entry]);
  x.context.fetch = async () => ({ok: false, status: 404});
  await x.api.applyImageProperty(entry, 'photo', 'https://media.test/a.png');
  assert.equal(entry.image('photo').value, authored);
  assert.equal(x.warnings.length, 1);
  x.context.fetch = async () => bytesResponse();
  const decoded = {}; x.fontRuntime.decodeImage = async () => decoded;
  await x.api.applyImageProperty(entry, 'photo', 'https://media.test/a.png');
  assert.equal(entry.image('photo').value, decoded);
});

test('JSON images: an old runtime cannot receive a late image assignment', async () => {
  const entry = model('Row', {photo: field('image', null)}), x = setup([entry]), gate = deferred();
  x.context.fetch = () => gate.promise;
  x.fontRuntime.decodeImage = async () => ({});
  const pending = x.api.applyImageProperty(entry, 'photo', 'https://media.test/a.png');
  x.api.widgetState.r = {};
  gate.resolve(bytesResponse()); await pending;
  assert.equal(entry.image('photo').value, null);
  assert.equal(x.plays.length, 0);
});
