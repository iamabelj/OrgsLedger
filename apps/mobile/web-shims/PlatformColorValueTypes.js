// Web shim for react-native's PlatformColorValueTypes
// On native, this handles PlatformColor (iOS semantic colors, Android resource paths).
// On web, these concepts don't apply, so we provide no-op stubs.

'use strict';

function PlatformColor() {
  // Return first name as a string fallback (CSS color name, etc.)
  return arguments.length > 0 ? arguments[0] : '';
}

function normalizeColorObject(color) {
  return null;
}

function processColorObject(color) {
  return null;
}

module.exports = {
  PlatformColor,
  normalizeColorObject,
  processColorObject,
};
