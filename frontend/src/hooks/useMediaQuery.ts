import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  // Lazy init from the live value so mobile doesn't flash the desktop
  // layout on first paint before the effect runs.
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    // No synchronous setState here: the lazy useState initializer above
    // already reflects the live value on mount, and the subscription below
    // delivers every later change. (The query string is constant at all
    // call sites, so there is no stale-query window to cover.)
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [query]);

  return matches;
}
