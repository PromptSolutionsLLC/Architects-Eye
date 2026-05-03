import { useCallback } from "react";
import {
  CARD_WIDTH,
  useStore,
  type EntityCard as EntityCardData,
} from "../store";
import { EntityBody, entityHeaderLabel } from "./EntityPanel";

const HEADER_H = 28;

interface Props {
  card: EntityCardData;
}

export function EntityCard({ card }: Props) {
  const dismissCard = useStore((s) => s.dismissCard);
  const togglePinCard = useStore((s) => s.togglePinCard);
  const toggleCollapseCard = useStore((s) => s.toggleCollapseCard);
  const moveCard = useStore((s) => s.moveCard);
  const bringCardToFront = useStore((s) => s.bringCardToFront);

  // Drag is started on the header; movement and release are tracked via
  // pointer-capture so dragging continues even if the cursor leaves the
  // header (or the window briefly loses focus).
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Buttons inside the header should NOT initiate a drag.
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const dx = e.clientX - card.position.x;
      const dy = e.clientY - card.position.y;
      bringCardToFront(card.cardId);

      const onMove = (ev: PointerEvent) => {
        moveCard(card.cardId, ev.clientX - dx, ev.clientY - dy);
      };
      const onUp = (ev: PointerEvent) => {
        if (target.hasPointerCapture(ev.pointerId)) {
          target.releasePointerCapture(ev.pointerId);
        }
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [card.cardId, card.position.x, card.position.y, moveCard, bringCardToFront],
  );

  const onCardPointerDown = useCallback(() => {
    bringCardToFront(card.cardId);
  }, [card.cardId, bringCardToFront]);

  const accent = card.pinned
    ? "rgba(251, 191, 36, 0.55)" // amber when pinned
    : "rgba(34, 211, 238, 0.18)"; // neutral cyan otherwise

  return (
    <div
      onPointerDown={onCardPointerDown}
      style={{
        position: "fixed",
        left: card.position.x,
        top: card.position.y,
        width: CARD_WIDTH,
        maxHeight: "80vh",
        zIndex: 1050 + card.zIndex,
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${accent}`,
        borderRadius: 2,
        boxShadow: card.pinned
          ? "0 0 0 1px rgba(251, 191, 36, 0.15), 0 8px 24px rgba(0,0,0,0.4)"
          : "0 8px 24px rgba(0,0,0,0.4)",
        fontFamily: "monospace",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
      }}
    >
      {/* Header: label + actions, doubles as drag handle */}
      <div
        onPointerDown={onHeaderPointerDown}
        style={{
          height: HEADER_H,
          minHeight: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          borderBottom: `1px solid ${accent}`,
          background: card.pinned
            ? "rgba(251, 191, 36, 0.08)"
            : "rgba(15, 23, 42, 0.6)",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            color: "#fbbf24",
            fontSize: 10,
            letterSpacing: "0.18em",
          }}
        >
          {entityHeaderLabel(card.entity)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <HeaderButton
            title={card.pinned ? "Unpin" : "Pin"}
            active={card.pinned}
            onClick={() => togglePinCard(card.cardId)}
          >
            {card.pinned ? "📌" : "📍"}
          </HeaderButton>
          <HeaderButton
            title={card.collapsed ? "Expand" : "Collapse"}
            onClick={() => toggleCollapseCard(card.cardId)}
          >
            {card.collapsed ? "▾" : "▴"}
          </HeaderButton>
          <HeaderButton
            title="Dismiss"
            onClick={() => dismissCard(card.cardId)}
          >
            ✕
          </HeaderButton>
        </div>
      </div>

      {/* Body — hidden when collapsed so only the header is visible */}
      {!card.collapsed && (
        <div
          style={{
            padding: "1.25rem",
            overflowY: "auto",
            // Reserve enough room for body when card is near viewport edge.
            maxHeight: "calc(80vh - 28px)",
          }}
        >
          <EntityBody entity={card.entity} />
        </div>
      )}
    </div>
  );
}

function HeaderButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      // No stopPropagation: the header's drag handler already
      // short-circuits when the pointerdown target is inside a button
      // (`closest('button')`), and we WANT the card-level pointerdown
      // to fire so this button click also brings the card to front.
      style={{
        background: "transparent",
        border: "none",
        color: active ? "#fbbf24" : "#94a3b8",
        cursor: "pointer",
        padding: "2px 6px",
        fontSize: 12,
        lineHeight: 1,
        fontFamily: "monospace",
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) =>
        ((e.target as HTMLButtonElement).style.color = active ? "#fde68a" : "#fff")
      }
      onMouseLeave={(e) =>
        ((e.target as HTMLButtonElement).style.color = active
          ? "#fbbf24"
          : "#94a3b8")
      }
    >
      {children}
    </button>
  );
}
