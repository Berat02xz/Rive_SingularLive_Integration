import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bytesResponse, createHarness, deferred, field, flushAsync, installLifecycleRuntime, model} from './helpers/widget-harness.mjs';

const fileUrl = 'https://files.test/example.riv';
function start(options) {
  const x = createHarness(), runtime = installLifecycleRuntime(x, options);
  x.api.widgetState.fileUrl = fileUrl;
  x.api.initializeRive(fileUrl);
  return Object.assign(x, runtime);
}

test('lifecycle: initialization keeps auto-binding and selected artboard/state machine configuration', () => {
  const x = createHarness(), {instances} = installLifecycleRuntime(x);
  Object.assign(x.api.widgetState, {artboardName: 'Second', stateMachineName: 'Animate'});
  x.api.initializeRive(fileUrl);
  const config = instances[0].config;
  assert.equal(config.src, fileUrl); assert.equal(config.canvas, x.elements.get('canvas'));
  assert.equal(config.autoBind, true); assert.equal(config.autoplay, true); assert.equal(config.useOffscreenRenderer, true);
  assert.equal(config.artboard, 'Second'); assert.equal(config.stateMachines, 'Animate');
  assert.equal(config.layout.fit, 'Contain'); assert.equal(x.api.widgetState.riveReady, false);
});

test('lifecycle: Canvas configuration omits the WebGL offscreen option', () => {
  const x = createHarness(), {instances} = installLifecycleRuntime(x);
  x.api.widgetState.runtime = 'canvas'; x.api.initializeRive(fileUrl);
  assert.equal(Object.hasOwn(instances[0].config, 'useOffscreenRenderer'), false);
});

test('startup: Singular values arriving before load are merged and replayed against bound accessors', async () => {
  const root = model('Main', {score: field('number', 1), title: field('string', 'authored')}), x = createHarness();
  const {instances} = installLifecycleRuntime(x, {root});
  const initial = {rive_file_url: fileUrl, rive_layout: '0', score: '3.0', title: 'initial'};
  await x.callbacks.onInit(initial);
  await x.callbacks.onValue({score: '12.5'});
  assert.equal(root.number('score').value, 1);
  instances[0].config.onLoad();
  assert.equal(x.publications.length, 1);
  x.runTimers(0); await flushAsync();
  assert.equal(root.number('score').value, 12.5); assert.equal(root.string('title').value, 'initial');
  assert.equal(initial.score, '3.0'); assert.equal(x.publications.length, 1);
  assert.equal(instances.length, 1); assert.equal(x.api.widgetState.pendingInitialValues.score, 12.5);
});

test('startup: persisted artboard selection is resolved before publishing controls', async () => {
  const x = start({artboards: ['Main', 'Second']});
  x.api.widgetState.pendingInitialValues = {riveartboard: '1'};
  x.instances[0].config.onLoad();
  assert.equal(x.publications.length, 0); assert.equal(x.instances[0].cleanups, 0);
  assert.equal(x.api.widgetState.artboardName, 'Second');
  x.runTimers(0); await flushAsync();
  assert.equal(x.instances[0].cleanups, 1); assert.equal(x.instances.length, 2);
  assert.equal(x.instances[1].config.artboard, 'Second');
  x.instances[1].config.onLoad(); x.runTimers(0); await flushAsync();
  assert.equal(x.publications.length, 1); assert.equal(x.instances.length, 2);
});

test('startup: persisted state machine selection reloads outside onLoad and then settles', async () => {
  const x = start({machines: ['Machine', 'Alternate']});
  x.api.widgetState.pendingInitialValues = {rivestatemachineselect: '1'};
  x.instances[0].config.onLoad();
  assert.equal(x.publications.length, 0); assert.equal(x.instances[0].cleanups, 0);
  x.runTimers(0); await flushAsync();
  assert.equal(x.instances[1].config.stateMachines, 'Alternate');
  x.instances[1].config.onLoad(); x.runTimers(0); await flushAsync();
  assert.equal(x.api.widgetState.stateMachineIndex, 1); assert.equal(x.instances.length, 2);
  assert.equal(x.publications.length, 1);
});

test('lifecycle: callbacks and reveal timers from an old load cannot affect a newer instance', () => {
  const x = start();
  x.instances[0].config.onLoad();
  assert.equal(x.api.widgetState.riveReady, true);
  x.api.initializeRive('https://files.test/new.riv');
  const current = x.instances[1];
  x.instances[0].config.onLoad(); x.runTimers(400);
  assert.equal(x.api.widgetState.r, current); assert.equal(x.api.widgetState.riveReady, false);
  assert.equal(x.publications.length, 1); assert.equal(x.elements.get('canvas').classList.contains('ready'), false);
  current.config.onLoad(); x.runTimers(400);
  assert.equal(x.elements.get('canvas').classList.contains('ready'), true);
});

test('lifecycle: stale asset-loader callbacks cannot register assets after a newer load', () => {
  const x = start(), stale = x.instances[0].config.assetLoader;
  x.api.initializeRive('https://files.test/new.riv');
  assert.equal(stale({isFont: true, name: 'Old.ttf'}, []), false);
  assert.deepEqual(Object.keys(x.api.widgetState.referencedFontAssets), []);
});

test('asset loader: embedded and CDN assets remain owned by Rive, and unknown assets are not intercepted', () => {
  const x = start(), loader = x.instances[0].config.assetLoader;
  for (const [asset, bytes] of [
    [{isFont: true, name: 'Embedded.ttf'}, Uint8Array.of(1)],
    [{isFont: true, name: 'Hosted.ttf', cdnUuid: 'some-cdn-id'}, []],
    [{isAudio: true, name: 'Hosted.wav', cdnUuid: 'some-cdn-id'}, []],
    [{isImage: true, name: 'picture.png'}, []],
  ]) assert.equal(loader(asset, bytes), false);
  assert.equal(Object.keys(x.api.widgetState.referencedFontAssets).length, 0);
  assert.equal(Object.keys(x.api.widgetState.referencedAudioAssets).length, 0);
});

test('asset loader: referenced font IDs remain compatible and decoded fonts are applied without reload', async () => {
  const x = start(), fonts = [];
  x.api.widgetState.metricFontData.rivefontExampleRegular = {family: 'Example'};
  x.api.fontBytesCache.set('Example|400|auto', Promise.resolve(Uint8Array.of(1)));
  let released = 0; const font = {unref() {released++;}};
  x.fontRuntime.decodeFont = async () => font;
  const asset = {isFont: true, name: 'Example-Regular.ttf', setFont(value) {fonts.push(value);}};
  assert.equal(x.instances[0].config.assetLoader(asset, []), true);
  await flushAsync();
  assert.equal(x.api.widgetState.referencedFontAssets.rivefontExampleRegular.asset, asset);
  assert.deepEqual(fonts, [font]); assert.equal(released, 1); assert.equal(x.instances.length, 1);
});

test('asset loader: cached audio is set synchronously before artboard initialization', () => {
  const x = start(), applied = [], decoded = {unref() {assert.fail('cache must retain the wrapper');}};
  x.api.widgetState.audioAssetUrls.riveaudioIntroSound = '//media.test/a.wav';
  x.api.audioDecodedCache['https://media.test/a.wav'] = decoded;
  assert.equal(x.instances[0].config.assetLoader({isAudio: true, name: 'Intro Sound.wav', setAudioSource(value) {applied.push(value);}}, []), true);
  assert.deepEqual(applied, [decoded]);
  assert.equal(x.api.widgetState.referencedAudioAssets.riveaudioIntroSound.fieldId, 'riveaudioIntroSound');
});

test('audio startup: a URL change decodes before reloading, then repeated values do not reload again', async () => {
  const x = start(), gate = deferred(), decoded = {unref() {}};
  x.instances[0].config.onLoad();
  x.instances[0].config.assetLoader({isAudio: true, name: 'Music.wav', setAudioSource() {}}, []);
  x.context.fetch = () => gate.promise;
  let decodes = 0;
  x.fontRuntime.decodeAudio = async () => {decodes++; return decoded;};
  await x.callbacks.onValue({riveaudioMusic: 'https://media.test/music.wav'});
  assert.equal(x.instances.length, 1); assert.equal(x.instances[0].cleanups, 1);
  gate.resolve(bytesResponse()); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(decodes, 1);
  const applied = [];
  x.instances[1].config.assetLoader({isAudio: true, name: 'Music.wav', setAudioSource(value) {applied.push(value);}}, []);
  assert.deepEqual(applied, [decoded]);
  x.instances[1].config.onLoad(); x.runTimers(0); await flushAsync();
  await x.callbacks.onValue({riveaudioMusic: 'https://media.test/music.wav'});
  assert.equal(x.instances.length, 2); assert.equal(decodes, 1);
});

test('late assets: repeated audio registration coalesces UI refreshes and preserves current values', () => {
  const x = start(); x.instances[0].config.onLoad();
  const loader = x.instances[0].config.assetLoader;
  x.api.widgetState.audioAssetUrls.riveaudioA = 'https://media.test/a.wav';
  // A cached source keeps this test entirely synchronous.
  x.api.audioDecodedCache['https://media.test/a.wav'] = {};
  loader({isAudio: true, name: 'A.wav', setAudioSource() {}}, []);
  loader({isAudio: true, name: 'B.wav'}, []);
  assert.equal(x.publications.length, 1);
  x.runTimers(100);
  assert.equal(x.publications.length, 2);
  const fields = x.publications[1].fields;
  assert.equal(fields.find(field => field.id === 'riveaudioA').defaultValue, 'https://media.test/a.wav');
  assert.equal(fields.find(field => field.id === 'riveaudioB').defaultValue, '');
});

test('reload races: only the newest file is initialized when old audio prefetch finishes late', async () => {
  const x = start(), first = deferred(), second = deferred(); let requests = 0;
  x.api.widgetState.audioAssetUrls.riveaudioMusic = 'https://media.test/music.wav';
  x.context.fetch = () => ++requests === 1 ? first.promise : second.promise;
  x.fontRuntime.decodeAudio = async () => ({unref() {}});
  x.api.reloadRive('https://files.test/old.riv');
  x.api.reloadRive('https://files.test/new.riv');
  second.resolve(bytesResponse([2])); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(x.instances[1].config.src, 'https://files.test/new.riv');
  first.resolve(bytesResponse([1])); await flushAsync();
  assert.equal(x.instances.length, 2);
});

test('artboard updates: a selection change clears the old machine and repeating it does not reload', async () => {
  const x = start({artboards: ['Main', 'Second']}); x.instances[0].config.onLoad();
  await x.callbacks.onValue({riveartboard: '1'}); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(x.instances[1].config.artboard, 'Second');
  assert.equal(x.instances[1].config.stateMachines, undefined);
  x.instances[1].config.onLoad(); x.runTimers(0); await flushAsync();
  await x.callbacks.onValue({riveartboard: '1'});
  assert.equal(x.instances.length, 2);
  assert.ok(x.releasedArtboards.includes(1));
});

test('configuration: changing layout reloads once; malformed artboard and machine indices do nothing', async () => {
  const x = start(); x.instances[0].config.onLoad();
  await x.callbacks.onValue({rive_layout: '1'}); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(x.instances[1].config.layout.fit, 'Cover');
  x.instances[1].config.onLoad();
  await x.callbacks.onValue({rive_layout: '1', riveartboard: '999', rivestatemachineselect: '-1'});
  assert.equal(x.instances.length, 2);
});

test('configuration: changing files clears previous artboard and machine choices but retains pending data', async () => {
  const x = start(); x.instances[0].config.onLoad();
  await x.callbacks.onValue({rive_file_url: 'https://files.test/new.riv', score: '12.5'}); await flushAsync();
  assert.equal(x.instances[1].config.src, 'https://files.test/new.riv');
  assert.equal(x.instances[1].config.artboard, undefined); assert.equal(x.instances[1].config.stateMachines, undefined);
  assert.equal(x.api.widgetState.pendingInitialValues.score, '12.5');
  await x.callbacks.onValue({rive_file_url: 'https://files.test/invalid.txt'});
  assert.equal(x.instances.length, 2); assert.equal(x.api.widgetState.fileUrl, 'https://files.test/new.riv');
});

test('runtime: switching renderer cleans old resources and unlocks after a failed script load', async () => {
  const x = start(), previous = x.instances[0]; let released = 0;
  x.api.audioDecodedCache.a = {unref() {released++;}};
  const failure = x.api.toggleRiveRuntime('canvas');
  assert.equal(previous.cleanups, 1); assert.equal(released, 1);
  assert.equal(x.api.widgetState.r, null); assert.equal(x.api.widgetState.riveReady, false);
  x.scripts[0].onerror(); await assert.rejects(failure, /Failed to load canvas/);
  assert.equal(x.api.widgetState._runtimeSwitching, null);
  const runtime = {}; // Install a fresh mocked browser runtime after its script loads.
  const retry = x.api.toggleRiveRuntime('canvas');
  x.context.window.rive = runtime;
  runtime.Rive = class {};
  const loaded = x.scripts[1].onload(); x.runTimers(50);
  await loaded; await retry;
  assert.equal(x.api.widgetState.runtime, 'canvas'); assert.equal(x.api.widgetState._runtimeSwitching, null);
});

test('runtime: concurrent requests for the same renderer share a single script load', async () => {
  const x = createHarness(), a = x.api.toggleRiveRuntime('webgl2'), b = x.api.toggleRiveRuntime('webgl2');
  assert.equal(x.scripts.length, 1);
  x.context.window.rive = {Rive: class {}};
  const loaded = x.scripts[0].onload(); x.runTimers(50);
  await loaded; await Promise.all([a, b]);
  assert.equal(x.scripts.length, 1); assert.equal(x.api.widgetState.runtime, 'webgl2');
});

test('canvas and FPS: resize follows widget dimensions and hidden counters ignore later callbacks', async () => {
  const x = start(); x.instances[0].config.onLoad();
  assert.equal(x.elements.get('canvas').width, 1920); assert.equal(x.elements.get('canvas').height, 1080);
  assert.equal(x.instances[0].resizes, 1);
  await x.callbacks.onValue({show_fps: true});
  const overlay = x.elements.get('rive-fps-counter');
  assert.equal(overlay.style.display, 'block');
  x.instances[0].fpsCallback(59.7); assert.equal(overlay.textContent, 'FPS: 60');
  await x.callbacks.onValue({show_fps: false});
  x.instances[0].fpsCallback(10);
  assert.equal(overlay.style.display, 'none'); assert.equal(overlay.textContent, 'FPS: 60');
});

test('load failures: only the active load reports its file and artboard context', () => {
  const x = start(); const stale = x.instances[0].config.onLoadError;
  x.api.initializeRive('https://files.test/new.riv');
  stale(Error('old')); assert.equal(x.warnings.length, 0);
  x.instances[1].config.onLoadError(Error('current'));
  assert.equal(x.warnings.length, 1); assert.equal(x.warnings[0][1].fileUrl, 'https://files.test/new.riv');
});

test('startup: WebGL script failure falls back to Canvas and retains Singular initial values', async () => {
  const x = createHarness(), runtime = installLifecycleRuntime(x);
  const module = x.fontRuntime;
  x.api.widgetState.runtime = '';
  const initializing = x.callbacks.onInit({rive_renderer: true, rive_file_url: fileUrl, score: '12.5'});
  assert.equal(x.scripts.length, 1); assert.match(x.scripts[0].src, /webgl2/);
  x.scripts[0].onerror(); await flushAsync();
  assert.equal(x.scripts.length, 2); assert.match(x.scripts[1].src, /canvas/);
  x.context.window.rive = module;
  const loaded = x.scripts[1].onload(); x.runTimers(50);
  await loaded; await initializing;
  assert.equal(x.api.widgetState.runtime, 'canvas'); assert.equal(runtime.instances.length, 1);
  assert.equal(runtime.instances[0].config.src, fileUrl);
  assert.equal(x.api.widgetState.pendingInitialValues.score, '12.5');
});

test('load watchdog: a stalled load reloads, while a successful load cancels its retry', async () => {
  const x = start();
  x.runTimers(5000); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(x.instances[0].cleanups, 1);
  x.instances[1].config.onLoad(); x.runTimers(5000); await flushAsync();
  assert.equal(x.instances.length, 2); assert.equal(x.api.widgetState.riveReady, true);
});
