import { useEffect, useState } from 'react';
import { locationCapability, LocationPermission } from '../../lib/startWeather';

export function getLocationCapability() {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature(name: string): boolean };
    featurePolicy?: { allowsFeature(name: string): boolean };
  };
  const policy = policyDocument.permissionsPolicy || policyDocument.featurePolicy;
  let policyAllowed: boolean | undefined;
  try { policyAllowed = policy?.allowsFeature('geolocation'); } catch { /* API is optional. */ }
  return locationCapability({ secure: window.isSecureContext, supported: Boolean(navigator.geolocation), policyAllowed });
}

// This checks permission only, never requests permission or reads coordinates.
export function useLocationPermission(open: boolean) {
  const [state, setState] = useState<LocationPermission>('checking');
  useEffect(() => {
    if (!open) return;
    let active = true;
    let revision = 0;
    let status: PermissionStatus | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => { if (active && status) setState(status.state); };
    const check = async () => {
      const request = ++revision;
      clearTimeout(deadline);
      status?.removeEventListener('change', onChange);
      const unavailable = getLocationCapability();
      if (unavailable) { setState(unavailable); return; }
      if (!navigator.permissions?.query) { setState('unknown'); return; }
      setState('checking');
      deadline = setTimeout(() => { if (active && request === revision) setState('unknown'); }, 2000);
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (!active || request !== revision) return;
        status = result;
        setState(result.state);
        result.addEventListener('change', onChange);
      } catch { if (active && request === revision) setState('unknown'); }
      finally { if (request === revision) clearTimeout(deadline); }
    };
    void check();
    window.addEventListener('focus', check);
    return () => {
      active = false;
      clearTimeout(deadline);
      status?.removeEventListener('change', onChange);
      window.removeEventListener('focus', check);
    };
  }, [open]);
  return state;
}
