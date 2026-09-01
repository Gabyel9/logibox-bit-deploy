/**
 * Shared utility for mapping Firebase error codes to user-friendly messages
 * This prevents exposure of raw Firebase error messages to the UI
 */

/**
 * Maps Firebase error messages to clean, user-friendly messages
 * @param {string} message - The raw Firebase error message
 * @returns {string} - A user-friendly error message
 */
export function cleanError(message) {
  if (!message) return 'Something went wrong. Please try again.';

  // Authentication errors
  if (message.includes('invalid-credential') || message.includes('wrong-password') || message.includes('user-not-found')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (message.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (message.includes('too-many-requests') || message.includes('too-many-attempts')) {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  if (message.includes('network-request-failed')) {
    return 'No internet connection. Please check your network.';
  }
  if (message.includes('popup-closed-by-user')) {
    return 'Google sign-in was cancelled.';
  }
  if (message.includes('popup-blocked')) {
    return 'Popup was blocked. Please allow popups and try again.';
  }
  if (message.includes('email-already-in-use')) {
    return 'An account with this email already exists.';
  }
  if (message.includes('weak-password')) {
    return 'Password is too weak. Please use a stronger password.';
  }
  if (message.includes('operation-not-allowed')) {
    return 'This operation is not allowed. Please contact support.';
  }

  // Password reset errors
  if (message.includes('auth/expired-action-code')) {
    return 'This reset link has expired. Please request a new one.';
  }
  if (message.includes('auth/invalid-action-code')) {
    return 'This reset link is invalid or has already been used. Please request a new one.';
  }
  if (message.includes('user-not-found') || message.includes('invalid-email')) {
    return 'No account found with this email address.';
  }

  // Generic fallback
  return 'Something went wrong. Please try again.';
}

/**
 * Maps Firebase callable function errors (HttpsError) to user-friendly messages
 * @param {string} code - The error code from HttpsError
 * @param {string} message - The raw error message
 * @returns {string} - A user-friendly error message
 */
export function cleanHttpsError(code, message) {
  if (!message) return 'Something went wrong. Please try again.';

  // Handle specific HttpsError codes
  switch (code) {
    case 'invalid-argument':
      return 'Invalid request. Please check your input and try again.';
    case 'unauthenticated':
      return 'Your session has expired. Please sign in again.';
    case 'permission-denied':
      return 'You do not have permission to perform this action.';
    case 'not-found':
      return 'The requested resource was not found.';
    case 'failed-precondition':
      return 'The request could not be completed in the current state.';
    case 'deadline-exceeded':
      return 'The operation took too long. Please try again.';
    case 'resource-exhausted':
      // Keep the rate limit message as-is since it's already user-friendly
      return message;
    case 'cancelled':
      return 'The operation was cancelled. Please try again.';
    case 'unknown':
    default:
      return cleanError(message);
  }
}

/**
 * Generic error handler that always returns safe, user-friendly messages
 * @param {Error|string} error - The error object or message string
 * @returns {string} - A safe error message for display
 */
export function getSafeErrorMessage(error) {
  if (!error) return 'Something went wrong. Please try again.';

  // Handle string errors
  if (typeof error === 'string') {
    return cleanError(error);
  }

  // Handle Error objects
  if (error.message) {
    return cleanError(error.message);
  }

  // Handle Firebase HttpsError with code and message
  if (error.code && error.message) {
    return cleanHttpsError(error.code, error.message);
  }

  return 'Something went wrong. Please try again.';
}