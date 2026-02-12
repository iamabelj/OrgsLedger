// ============================================================
// OrgsLedger — Error Boundary
// ============================================================

import React, { Component, ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              {this.state.error?.message || 'Unknown error'}
            </Text>
            <Text style={styles.stack}>
              {this.state.error?.stack?.slice(0, 800)}
            </Text>
            {this.state.errorInfo && (
              <Text style={styles.stack}>
                {this.state.errorInfo.componentStack?.slice(0, 500)}
              </Text>
            )}
            <TouchableOpacity style={styles.button} onPress={this.handleReset}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1426',
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#C9A84C',
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    color: '#F0EDE5',
    textAlign: 'center',
    marginBottom: 16,
  },
  stack: {
    fontSize: 11,
    color: '#8E99A9',
    fontFamily: 'monospace',
    marginBottom: 16,
    maxWidth: '100%',
  },
  button: {
    backgroundColor: '#C9A84C',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginTop: 16,
  },
  buttonText: {
    color: '#0B1426',
    fontSize: 16,
    fontWeight: '600',
  },
});
