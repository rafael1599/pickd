import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';
import './mocks/supabase';

// Cleanup mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
