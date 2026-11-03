// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";
import { SectionHeader } from "./PageHeader";
import { Button } from "./ui/button";

export const hiddenScrollbar = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const cardShelf = [
  "library-card-shelf grid grid-flow-col overflow-x-auto overscroll-x-contain",
  "[scroll-snap-type:x_proximity] [&>*]:[scroll-snap-align:start]",
  hiddenScrollbar,
].join(" ");

const scrollFade =
  "[mask-image:linear-gradient(to_right,#000_calc(100%-3.5rem),transparent)] max-md:[mask-image:none]";

const capEightOnMobile = "max-md:[&>*:nth-child(n+9)]:hidden";

export function Shelf<T extends string, U extends string>({
  title,
  titleHref,
  note,
  href,
  className,
  children,
}: {
  title: string;
  titleHref?: Route<U>;
  note?: string;
  href?: Route<T>;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const shelf = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  useEffect(() => {
    const element = shelf.current;
    if (!element) return;

    const update = () => {
      const furthest = element.scrollWidth - element.clientWidth;
      setEdges({ atStart: element.scrollLeft <= 1, atEnd: element.scrollLeft >= furthest - 1 });
    };

    const resize = new ResizeObserver(update);
    resize.observe(element);
    element.addEventListener("scroll", update, { passive: true });

    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);

  const scroll = (direction: 1 | -1) => {
    const element = shelf.current;
    element?.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className={cn("group/section flex flex-col gap-4", className)}>
      <SectionHeader
        title={title}
        titleHref={titleHref}
        note={note}
        href={href}
        actions={
          !(edges.atStart && edges.atEnd) && (
            <div className="flex gap-1 opacity-0 transition-opacity duration-150 ease-brand group-focus-within/section:opacity-100 group-hover/section:opacity-100 max-md:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => scroll(-1)}
                disabled={edges.atStart}
                aria-label={t("shelf.scrollBackwards", { title })}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => scroll(1)}
                disabled={edges.atEnd}
                aria-label={t("shelf.scrollForwards", { title })}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          )
        }
      />

      <div ref={shelf} className={cn(cardShelf, scrollFade, capEightOnMobile, "-mt-2 pt-2 pb-2")}>
        {children}
      </div>
    </section>
  );
}
