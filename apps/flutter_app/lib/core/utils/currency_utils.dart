/// Currency utilities for displaying amounts with the correct symbol.
library;

const Map<String, String> _currencySymbols = {
  'USD': '\$',
  'EUR': '€',
  'GBP': '£',
  'NGN': '₦',
  'GHS': '₵',
  'KES': 'KSh',
  'ZAR': 'R',
  'CAD': 'CA\$',
  'AUD': 'A\$',
  'INR': '₹',
};

/// Returns the symbol for a given ISO 4217 currency code.
String currencySymbol(String? code) {
  if (code == null || code.isEmpty) return '\$';
  return _currencySymbols[code.toUpperCase()] ?? code;
}

/// Formats an amount with the correct currency symbol.
String formatCurrency(double amount, {String? currency}) {
  final sym = currencySymbol(currency);
  return '$sym${amount.toStringAsFixed(2)}';
}
