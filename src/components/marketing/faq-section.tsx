import { FaqAccordion } from "./faq";
import type { FaqItem } from "./faq-data";

export function FaqSection({ items }: { items?: FaqItem[] }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 pb-20 sm:pb-28">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 sm:px-8 md:grid-cols-[1fr_1.7fr] md:gap-16">
        <h2 id="faq-title" className="text-3xl font-bold tracking-[-0.045em] sm:text-4xl">Questions fréquentes</h2>
        <FaqAccordion items={items} />
      </div>
    </section>
  );
}
