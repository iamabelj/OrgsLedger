// Generic stub module for react-native internals that don't exist on web.
// When Metro tries to resolve an internal RN module on web platform and fails,
// this stub is returned instead of crashing the bundler.

'use strict';

const noop = function () {};
const identity = function (x) { return x; };
const emptyObj = {};
const falseFn = function () { return false; };
const nullFn = function () { return null; };
const zeroFn = function () { return 0; };

// Cover common patterns used by RN internals
module.exports = new Proxy(emptyObj, {
  get: function (_target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return emptyObj;
    if (prop === 'NativeModules') return emptyObj;
    if (prop === 'Platform') return { OS: 'web', select: function (obj) { return obj.web || obj.default; } };
    if (prop === 'processColorObject') return nullFn;
    if (prop === 'normalizeColorObject') return nullFn;
    if (prop === 'PlatformColor') return identity;
    if (prop === 'register') return noop;
    if (prop === 'unregister') return noop;
    if (prop === 'getConstants') return function () { return {}; };
    if (prop === 'addEventListener') return noop;
    if (prop === 'removeEventListener') return noop;
    if (prop === 'addListener') return function () { return { remove: noop }; };
    if (prop === 'removeListeners') return noop;
    if (prop === 'removeSubscription') return noop;
    if (prop === 'emit') return noop;
    if (prop === 'render') return noop;
    if (prop === 'unmountComponentAtNode') return noop;
    // Numeric values
    if (prop === 'scale') return 1;
    if (prop === 'fontScale') return 1;
    // For view configs
    if (prop === 'validAttributes') return {};
    if (prop === 'uiViewClassName') return 'RCTView';
    if (prop === 'bubblingEventTypes') return {};
    if (prop === 'directEventTypes') return {};
    // Catch-all: return noop function for any unknown property
    return noop;
  },
});
