// ============================================================
// OrgsLedger — Logo Asset Source (Cross-platform)
// ============================================================
// On native: uses require() asset bundling (works perfectly).
// On web:    uses URI to /logo-192.png which post-export-web.js
//            copies to the web root — avoids Expo web asset
//            registry ID resolution issues.
// ============================================================

import { Platform, ImageSourcePropType } from 'react-native';

export const LOGO: ImageSourcePropType =
  Platform.OS === 'web'
    ? { uri: '/logo-192.png' }
    : require('../assets/logo-no-bg.png');
