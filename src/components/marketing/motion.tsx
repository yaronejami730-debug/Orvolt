"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Apparition au défilement (fondu + léger glissement), échelonnée par `index`. Sans animation si l'utilisateur les a réduites. */
export function Reveal({ children, index = 0, className, as = "div", ...rest }: { children: ReactNode; index?: number; className?: string; as?: "div" | "article" | "section" } & Record<string, unknown>) {
  const reduce = useReducedMotion();
  const M = motion[as];
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, ease: EASE, delay: reduce ? 0 : index * 0.08 }}
      {...rest}
    >
      {children}
    </M>
  );
}

/** Texte qui se renouvelle à chaque changement de `value` (prix, formule) : entrée en glissant, un seul élément dans le DOM. */
export function Swap({ value, children, className, ...rest }: { value: string | number; children: ReactNode; className?: string } & Record<string, unknown>) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={value}
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      style={{ display: "inline-block" }}
      {...rest}
    >
      {children}
    </motion.span>
  );
}
