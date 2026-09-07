// AsyncStorage ships a documented in-memory jest mock; use it so onboarding
// prefs (the resume state) are testable without a native store.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
