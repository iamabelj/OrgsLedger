// Web shim for react-native's AssetRegistry
// Metro sometimes resolves this from RN internals on web.

'use strict';

const assets = [];

function registerAsset(asset) {
  return assets.push(asset);
}

function getAssetByID(assetId) {
  return assets[assetId - 1];
}

module.exports = { registerAsset, getAssetByID };
