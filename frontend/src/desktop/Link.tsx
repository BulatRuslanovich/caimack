// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithRef } from "react";
import { navigate } from "./navigation";

type Props = ComponentPropsWithRef<"a"> & {
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  onNavigate?: (event: { preventDefault(): void }) => void;
};

export default function Link({ prefetch, replace, scroll, onClick, onNavigate, ...props }: Props) {
  return (
    <a
      {...props}
      data-prefetch={prefetch === false ? "off" : undefined}
      onClick={(event) => {
        onClick?.(event);
        const anchor = event.currentTarget;
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          anchor.hasAttribute("download") ||
          (anchor.target && anchor.target !== "_self") ||
          anchor.origin !== location.origin ||
          props.href?.startsWith("#")
        )
          return;
        event.preventDefault();
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
          },
        });
        if (!prevented) navigate(anchor.href, replace, scroll);
      }}
    />
  );
}
