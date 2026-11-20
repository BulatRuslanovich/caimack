// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export default function dynamic<T extends object>(
  load: () => Promise<ComponentType<T> | { default: ComponentType<T> }>,
  options?: { loading?: () => ReactNode; ssr?: boolean },
) {
  const Component = lazy(async () => {
    const component = await load();
    return "default" in component ? component : { default: component };
  });
  return function LazyComponent(props: T) {
    return (
      <Suspense fallback={options?.loading?.() ?? null}>
        <Component {...props} />
      </Suspense>
    );
  };
}
