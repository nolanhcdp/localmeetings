// Vercel Web Analytics initialization
// Import and inject the analytics script for all pages
import { inject } from '/lib/analytics.mjs';

// Initialize Vercel Web Analytics
inject({
  mode: 'auto', // Automatically detect environment (production/development)
  debug: false  // Set to true for debugging
});
