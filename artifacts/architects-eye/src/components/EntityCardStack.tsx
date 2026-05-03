import { useEffect } from "react";
import { useStore } from "../store";
import { EntityCard } from "./EntityCard";

export function EntityCardStack() {
  const cards = useStore((s) => s.cards);
  const clampAllCards = useStore((s) => s.clampAllCards);

  // Clamp every card on viewport resize so headers can always be
  // grabbed (≥80 px of header on-screen).
  useEffect(() => {
    const handler = () => clampAllCards(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [clampAllCards]);

  return (
    <>
      {cards.map((card) => (
        <EntityCard key={card.cardId} card={card} />
      ))}
    </>
  );
}
