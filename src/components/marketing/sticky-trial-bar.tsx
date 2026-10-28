"use client";

import { useEffect, useState } from "react";
import { TrialCta } from "./trial-cta";

/** Barre d'essai collante, mobile seulement : visible après le hero, masquée dès que la section finale approche. */
export function StickyTrialBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const update = () => {
      const end = document.getElementById("essai");
      const pastHero = window.scrollY > window.innerHeight * 0.8;
      const nearEnd = end ? end.getBoundingClientRect().top < window.innerHeight : false;
      setShow(pastHero && !nearEnd);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div
      data-testid="sticky-trial-bar"
      aria-hidden={!show}
      inert={!show}
      className={`fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md transition-transform duration-200 md:hidden ${show ? "translate-y-0" : "translate-y-full"}`}
    >
      <TrialCta size="md" buttonClassName="w-full" className="items-stretch" />
    </div>
  );
}
