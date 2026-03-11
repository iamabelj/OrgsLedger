/// API base URL configuration.
const kApiBaseUrlProd = 'https://app.orgsledger.com/api';
const kApiBaseUrlDev = 'http://localhost:3000/api';

const kSocketUrlProd = 'https://app.orgsledger.com';
const kSocketUrlDev = 'http://localhost:3000';

/// Use production by default; flipped in debug builds.
const bool kUseProd = bool.fromEnvironment(
  'dart.vm.product',
  defaultValue: true,
);
String get kApiBaseUrl => kUseProd ? kApiBaseUrlProd : kApiBaseUrlDev;
String get kSocketUrl => kUseProd ? kSocketUrlProd : kSocketUrlDev;
