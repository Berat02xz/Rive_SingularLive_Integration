import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const widgetPath = fileURLToPath(new URL('../../RiveLink/source/output.html', import.meta.url));
const html = fs.readFileSync(widgetPath, 'utf8');
const scriptStart = html.indexOf('<script>') + 8;
const scriptEnd = html.lastIndexOf('</script>');
// Preserve character offsets as well as lines: V8 maps coverage to the HTML file.
const blankMarkup = text => text.replace(/[^\r\n]/g, ' ');
const script = blankMarkup(html.slice(0, scriptStart)) + html.slice(scriptStart, scriptEnd)
  + blankMarkup(html.slice(scriptEnd));
const exposed = [
  'widgetState', 'getAllViewModelProperties', 'fontBytesCache', 'audioDecodedCache',
  'resolveFontBytes', 'fetchAndApplyFont', 'prepareRiveGlyphFallbackFonts', 'releaseRiveGlyphFallbackFonts',
  'prefetchAudioAssets', 'fetchAndApplyAudio', 'releaseDecodedAudioCache',
  'handleListUpdate', 'applyPropsToInstance', 'readInstanceProperties', 'handleScalarUpdate',
  'normalizeScalarValue', 'updateDynamicProperties', 'onSingularValue', 'onSingularButtonClicked',
  'generateUIModel', 'handleImageUpdate', 'applyImageProperty', 'initializeRive', 'reloadRive',
  'toggleRiveRuntime', 'resizeCanvas', 'ensureFPSCounter',
];

// Each test executes the complete shipped script in a fresh browser/SDK sandbox.
// Only external boundaries are mocked; widget handlers are never replaced.
export function createHarness() {
  const warnings = [], errors = [], publications = [], scripts = [], timers = new Map();
  const elements = new Map();
  let nextTimer = 0, callbacks;
  const makeElement = tagName => {
    const classes = new Set();
    return {tagName, style: {}, textContent: '', width: 0, height: 0,
      classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)},
      remove() {elements.delete(this.id);}};
  };
  for (const id of ['canvas', 'rive-fps-counter']) elements.set(id, makeElement(id));
  const sdk = {
    init(value) {callbacks = value;},
    setCustomWidgetUI(value) {publications.push(value); return {success: true};},
  };
  const context = {
    window: {addEventListener() {}, rive: {}, innerWidth: 1920, innerHeight: 1080},
    document: {
      getElementById: id => elements.get(id) || null,
      createElement: makeElement,
      body: {prepend(element) {scripts.push(element); elements.set(element.id, element);}},
    },
    SingularWidget: sdk,
    console: {warn: (...args) => warnings.push(args), error: (...args) => errors.push(args), info() {}, log() {}},
    setTimeout(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
    setInterval(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, delay, interval: true}); return id;},
    clearInterval(id) {timers.delete(id);},
    fetch: async () => {throw new Error('Unexpected network request in test');},
    Uint8Array,
  };
  // In a browser, window.rive is also available as the global `rive`.
  Object.defineProperty(context, 'rive', {get: () => context.window.rive});
  vm.runInNewContext(`${script};globalThis.api={${exposed.join(',')}};`, context, {filename: widgetPath});
  return {api: context.api, context, sdk, warnings, errors, publications, scripts, timers, elements,
    get callbacks() {return callbacks;},
    get fontRuntime() {return context.window.rive;},
    runTimers(delay) {
      const pending = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of pending) {
        if (!timers.has(id)) continue;
        if (!timer.interval) timers.delete(id);
        timer.fn();
      }
    },
  };
}

export function model(name, fields) {
  const result = {viewModelName: name, fields,
    properties: Object.entries(fields).map(([name, field]) => ({name, type: field.type}))};
  result.nativeInstance = {isAliasOf(other) {return this === other;}};
  function lookup(path) {
    const parts = path.split('/');
    let current = result;
    for (const key of parts.slice(0, -1)) current = current?.fields[key]?.instance;
    return current?.fields[parts.at(-1)];
  }
  for (const type of ['string', 'number', 'boolean', 'image', 'font', 'color', 'list', 'trigger', 'artboard']) {
    result[type] = path => {const field = lookup(path); return field?.type === type ? field.accessor : null;};
  }
  result.enum = path => ['enum', 'enumType'].includes(lookup(path)?.type) ? lookup(path).accessor : null;
  result.viewModel = path => lookup(path)?.instance || null;
  return result;
}

export function field(type, initial) {
  let value = initial;
  return {type, accessor: {get value() {return value;}, set value(next) {
    if (['string', 'number', 'boolean'].includes(type)) assert.equal(typeof next, type);
    value = next;
  }}};
}

export function row(values = {}, name = 'Row') {
  const result = model(name, {
    id: field('string', ''), title: field('string', 'authored'), subtitle: field('string', 'subtitle'),
    visible: field('boolean', true), size__: field('number', 24), score: field('number', 5),
    ordinaryNumber: field('number', 0), normalizedNumber: field('number', 0), counter: field('number', 0),
  });
  for (const [key, value] of Object.entries(values)) result.fields[key].accessor.value = value;
  return result;
}

export function list(initial) {
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

export function setup(initial = [row()], itemVMName = 'Row') {
  const x = createHarness(), plays = [];
  const rows = list(initial);
  const root = model('Root', {rows: {type: 'list', accessor: rows}});
  const definitions = new Map([['Row', {properties: row().properties, defaultInstance: () => row(),
    instance: () => row({size__: 0, visible: false})}]]);
  const runtime = {viewModelInstance: root, viewModelByName: name => definitions.get(name), play: name => plays.push(name)};
  Object.assign(x.api.widgetState, {r: runtime, stateMachineName: 'Machine', _findVMNameForInstance: inst => inst?.viewModelName});
  const prop = {type: 'list', path: 'rows', ownerInstance: root, accessor: rows, itemVMName};
  return Object.assign(x, {rows, prop, root, runtime, plays, definitions,
    apply: data => x.api.handleListUpdate(prop, data)});
}

export function discover(x) {
  const discovered = x.api.getAllViewModelProperties(x.runtime);
  Object.assign(x.api.widgetState, {
    riveProps: discovered.props, vmMetadata: discovered.vmMetadata,
    defaultVMName: discovered.defaultVMName, globalViewModelNames: discovered.globalViewModelNames,
  });
  return discovered;
}

export function setupViewModels(main, globals = {}, assets = {}) {
  const x = setup();
  Object.assign(x.runtime, {
    viewModelInstance: main,
    defaultViewModel: () => ({name: main.viewModelName, properties: main.properties}),
    globalViewModelNames: () => Object.keys(globals),
    globalViewModelInstance: name => globals[name],
  });
  for (const [name, instance] of Object.entries(globals)) x.definitions.set(name, {name, properties: instance.properties});
  Object.assign(x.api.widgetState, assets);
  const discovered = discover(x);
  x.api.widgetState.riveReady = true;
  return Object.assign(x, {discovered});
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

// Flush background image/font work through an event-loop turn, without sleeping.
export const flushAsync = () => new Promise(resolve => setImmediate(resolve));
export const plain = value => JSON.parse(JSON.stringify(value));
export const bytesResponse = (bytes = [1, 2, 3]) => ({ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer});

export function installLifecycleRuntime(x, {root = model('Main', {}), artboards = ['Main'], machines = ['Machine']} = {}) {
  const instances = [], releasedArtboards = [];
  const file = {
    artboardCount: () => artboards.length,
    artboardByIndex(index) {return {name: artboards[index], delete() {releasedArtboards.push(index);}};},
    defaultArtboard() {return {name: artboards[0], delete() {releasedArtboards.push('default');}};},
  };
  Object.assign(x.fontRuntime, {
    Fit: {Contain: 'Contain', Cover: 'Cover'}, Layout: class {constructor(options) {Object.assign(this, options);}},
    Rive: class {
      constructor(config) {
        this.config = config; this.file = file; this.activeArtboard = config.artboard || artboards[0];
        this.stateMachineNames = machines;
        this.playingStateMachineNames = machines.length ? [config.stateMachines || machines[0]] : [];
        this.viewModelInstance = root; this.plays = []; this.cleanups = 0; this.resizes = 0;
        instances.push(this);
      }
      defaultViewModel() {return {name: root.viewModelName, properties: root.properties};}
      globalViewModelNames() {return [];}
      cleanup() {this.cleanups++;}
      play(name) {this.plays.push(name);}
      resizeDrawingSurfaceToCanvas() {this.resizes++;}
      enableFPSCounter(callback) {this.fpsCallback = callback;}
    },
  });
  Object.assign(x.api.widgetState, {runtime: 'webgl2', layoutFit: 'Contain'});
  return {instances, file, releasedArtboards};
}
