/**
 * Sanitization utilities to prevent XSS attacks
 */

/**
 * Strips HTML tags from a string to prevent XSS
 * @param {string} str - The string to sanitize
 * @returns {string} - The sanitized string with HTML tags removed
 */
export function stripHtml(str) {
  if (str == null || typeof str !== 'string') {
    return '';
  }
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Escapes HTML entities to prevent XSS when rendering user content
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string
 */
export function escapeHtml(str) {
  if (str == null || typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes user input for safe display in the UI
 * Combines HTML escaping with additional sanitization
 * @param {string} str - The user input to sanitize
 * @returns {string} - The sanitized string safe for rendering
 */
export function sanitizeUserInput(str) {
  if (str == null || typeof str !== 'string') {
    return '';
  }
  // First strip any HTML tags
  let sanitized = stripHtml(str);
  // Then escape any remaining HTML entities
  return escapeHtml(sanitized);
}

/**
 * Sanitizes display text for log entries and activity logs
 * @param {string} text - The text to sanitize
 * @returns {string} - Safe text for display
 */
export function sanitizeLogText(text) {
  return sanitizeUserInput(text);
}