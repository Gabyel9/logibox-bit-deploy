import { useState, useEffect, useRef, useCallback } from 'react';

export function useVaultTimer(expiresAt, onExpired) {
  const [msRemaining, setMsRemaining] = useState(0);
  const [isExpired, setIsExpired] = useState(false);
  const hasCalledOnExpired = useRef(false);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    if (!expiresAt) {
      setMsRemaining(0);
      setIsExpired(true);
      return;
    }

    const calculateRemaining = () => {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      const remaining = Math.max(0, expiry - now);
      return remaining;
    };

    const initialRemaining = calculateRemaining();
    if (initialRemaining <= 0) {
      setMsRemaining(0);
      setIsExpired(true);
      return;
    }

    setMsRemaining(initialRemaining);
    setIsExpired(false);
    hasCalledOnExpired.current = false;

    const interval = setInterval(() => {
      const remaining = calculateRemaining();
      setMsRemaining(remaining);
      if (remaining <= 0) {
        setIsExpired(true);
        clearInterval(interval);
        if (onExpiredRef.current && !hasCalledOnExpired.current) {
          hasCalledOnExpired.current = true;
          onExpiredRef.current();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return { msRemaining, isExpired };
}