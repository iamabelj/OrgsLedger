// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-yarn-workspace-root`
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Fix web: shim react-native internal modules that don't exist on web.
//    The babel-plugin-react-native-web rewrites top-level imports like
//    `import { X } from 'react-native'` → `react-native-web/dist/exports/X`,
//    but internal RN modules that do `require('./SomeInternal')` still hit
//    the real react-native package and fail when web-only files are missing.
//    Strategy: try default resolution first; if it fails for paths inside
//    react-native/Libraries on web, return a generic stub module.

const shimsDir = path.resolve(projectRoot, 'web-shims');
const emptyModule = path.resolve(shimsDir, '__empty_module.js');

// react-native-web export aliases for known modules
const rnWebExportsDir = path.resolve(
  projectRoot,
  'node_modules/react-native-web/dist/exports'
);

const rnWebReplacements = {
  'Utilities/Platform': 'Platform',
  'exports/Platform': 'Platform',
};

const customShims = {
  'PlatformColorValueTypes': 'PlatformColorValueTypes.js',
  'PlatformColorValueTypesIOS': 'PlatformColorValueTypes.js',
  'PlatformColorValueTypesAndroid': 'PlatformColorValueTypes.js',
  'AssetRegistry': 'AssetRegistry.js',
};

// Native-only packages that must NEVER be bundled on web.
// Metro doesn't do dead-code elimination, so even `if (Platform.OS !== 'web') require(...)`
// still gets bundled & executed, crashing with __fbBatchedBridgeConfig errors.
const nativeOnlyPackages = [
  '@stripe/stripe-react-native',
  'expo-secure-store',
  'expo-notifications',
  'expo-image-picker',
  'expo-document-picker',
  'expo-file-system',
  'expo-camera',
  'expo-av',
  'expo-haptics',
  'expo-speech',
  'expo-barcode-scanner',
  'expo-local-authentication',
  'react-native-gesture-handler',
];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    // Block native-only packages entirely — return empty stub
    if (nativeOnlyPackages.some((pkg) => moduleName === pkg || moduleName.startsWith(pkg + '/'))) {
      return { filePath: emptyModule, type: 'sourceFile' };
    }

    // Explicit react-native-web replacements
    for (const [pattern, rnWebModule] of Object.entries(rnWebReplacements)) {
      if (moduleName.includes(pattern)) {
        return {
          filePath: path.resolve(rnWebExportsDir, rnWebModule, 'index.js'),
          type: 'sourceFile',
        };
      }
    }

    // Explicit custom shims
    for (const [pattern, shimFile] of Object.entries(customShims)) {
      if (moduleName.includes(pattern)) {
        return {
          filePath: path.resolve(shimsDir, shimFile),
          type: 'sourceFile',
        };
      }
    }

    // Catch-all: if resolution fails for react-native internals, return stub
    const defaultResolve = originalResolveRequest || context.resolveRequest;
    try {
      return defaultResolve(context, moduleName, platform);
    } catch (error) {
      // Check if the failing import originates from react-native internals
      const originDir = context.originModulePath || '';
      const isRNInternal =
        originDir.includes('react-native' + path.sep + 'Libraries') ||
        originDir.includes('react-native/Libraries') ||
        originDir.includes('react-native\\Libraries');

      if (isRNInternal) {
        return { filePath: emptyModule, type: 'sourceFile' };
      }
      throw error;
    }
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
