"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Product } from "@/lib/api";
import {
  createInitialSelection,
  reduceProductSelection,
  resolveSelection,
  type ProductSelectionDerived,
  type ProductSelectionState,
} from "@/lib/product-selection";

export interface PurchaseLineState extends ProductSelectionState {
  clientLineId: string;
}

export interface PdpPurchaseContextValue {
  product: Product;
  orderLines: readonly PurchaseLineState[];
  primaryLine: PurchaseLineState;
  primaryDerived: ProductSelectionDerived;
  selectOption(lineId: string, optionId: string, valueId: string): void;
  confirmLine(lineId: string): void;
  setQuantity(lineId: string, quantity: number): void;
  addLine(): string;
  removeLine(lineId: string): void;
  changeLineVariant(lineId: string): void;
}

export type PurchaseLinesAction =
  | {
      type: "SELECT_OPTION";
      lineId: string;
      optionId: string;
      valueId: string;
    }
  | { type: "CONFIRM_LINE"; lineId: string }
  | { type: "SET_QUANTITY"; lineId: string; quantity: number }
  | { type: "ADD_LINE"; clientLineId: string }
  | { type: "REMOVE_LINE"; lineId: string }
  | { type: "CHANGE_LINE_VARIANT"; lineId: string };

const PRIMARY_LINE_ID = "primary";

function createPurchaseLine(
  product: Product,
  clientLineId: string,
  initialVariantId?: string | null,
): PurchaseLineState {
  return {
    clientLineId,
    ...createInitialSelection(product, initialVariantId),
  };
}

export function createInitialPurchaseLines(
  product: Product,
  initialVariantId?: string | null,
): PurchaseLineState[] {
  return [createPurchaseLine(product, PRIMARY_LINE_ID, initialVariantId)];
}

function updateLine(
  product: Product,
  lines: readonly PurchaseLineState[],
  lineId: string,
  action:
    | { type: "SELECT_OPTION"; optionId: string; valueId: string }
    | { type: "CONFIRM" }
    | { type: "SET_QUANTITY"; quantity: number }
    | { type: "CHANGE_VARIANT" },
): PurchaseLineState[] | readonly PurchaseLineState[] {
  const index = lines.findIndex(({ clientLineId }) => clientLineId === lineId);
  if (index < 0) return lines;

  const current = lines[index];
  const next = reduceProductSelection(product, current, action);
  if (next === current) return lines;

  const updated = [...lines];
  updated[index] = { clientLineId: current.clientLineId, ...next };
  return updated;
}

export function reducePurchaseLines(
  product: Product,
  lines: readonly PurchaseLineState[],
  action: PurchaseLinesAction,
): PurchaseLineState[] | readonly PurchaseLineState[] {
  switch (action.type) {
    case "SELECT_OPTION":
      return updateLine(product, lines, action.lineId, {
        type: "SELECT_OPTION",
        optionId: action.optionId,
        valueId: action.valueId,
      });

    case "CONFIRM_LINE":
      return updateLine(product, lines, action.lineId, { type: "CONFIRM" });

    case "SET_QUANTITY":
      return updateLine(product, lines, action.lineId, {
        type: "SET_QUANTITY",
        quantity: action.quantity,
      });

    case "CHANGE_LINE_VARIANT":
      return updateLine(product, lines, action.lineId, {
        type: "CHANGE_VARIANT",
      });

    case "ADD_LINE":
      if (lines.some(({ clientLineId }) => clientLineId === action.clientLineId)) {
        return lines;
      }
      return [
        ...lines,
        createPurchaseLine(product, action.clientLineId),
      ];

    case "REMOVE_LINE": {
      const index = lines.findIndex(
        ({ clientLineId }) => clientLineId === action.lineId,
      );
      if (index < 0) return lines;
      if (index === 0) {
        const resetPrimary = createPurchaseLine(
          product,
          lines[0].clientLineId,
        );
        return [resetPrimary, ...lines.slice(1)];
      }
      return lines.filter(({ clientLineId }) => clientLineId !== action.lineId);
    }
  }
}

const PdpPurchaseContext = createContext<PdpPurchaseContextValue | null>(null);

export function PdpPurchaseProvider({
  product,
  initialVariantId,
  children,
}: {
  product: Product;
  initialVariantId?: string | null;
  children: ReactNode;
}) {
  const [orderLines, setOrderLines] = useState<PurchaseLineState[]>(() =>
    createInitialPurchaseLines(product, initialVariantId),
  );
  const nextLineNumber = useRef(1);

  const dispatch = useCallback(
    (action: PurchaseLinesAction) => {
      setOrderLines((current) => [
        ...reducePurchaseLines(product, current, action),
      ]);
    },
    [product],
  );

  const selectOption = useCallback(
    (lineId: string, optionId: string, valueId: string) => {
      dispatch({ type: "SELECT_OPTION", lineId, optionId, valueId });
    },
    [dispatch],
  );
  const confirmLine = useCallback(
    (lineId: string) => dispatch({ type: "CONFIRM_LINE", lineId }),
    [dispatch],
  );
  const setQuantity = useCallback(
    (lineId: string, quantity: number) => {
      dispatch({ type: "SET_QUANTITY", lineId, quantity });
    },
    [dispatch],
  );
  const addLine = useCallback(() => {
    let clientLineId: string;
    do {
      clientLineId = `line-${nextLineNumber.current}`;
      nextLineNumber.current += 1;
    } while (orderLines.some((line) => line.clientLineId === clientLineId));
    dispatch({ type: "ADD_LINE", clientLineId });
    return clientLineId;
  }, [dispatch, orderLines]);
  const removeLine = useCallback(
    (lineId: string) => dispatch({ type: "REMOVE_LINE", lineId }),
    [dispatch],
  );
  const changeLineVariant = useCallback(
    (lineId: string) => dispatch({ type: "CHANGE_LINE_VARIANT", lineId }),
    [dispatch],
  );

  const primaryLine = orderLines[0];
  const primaryDerived = useMemo(
    () => resolveSelection(product, primaryLine),
    [primaryLine, product],
  );
  const value = useMemo<PdpPurchaseContextValue>(
    () => ({
      product,
      orderLines,
      primaryLine,
      primaryDerived,
      selectOption,
      confirmLine,
      setQuantity,
      addLine,
      removeLine,
      changeLineVariant,
    }),
    [
      addLine,
      changeLineVariant,
      confirmLine,
      orderLines,
      primaryDerived,
      primaryLine,
      product,
      removeLine,
      selectOption,
      setQuantity,
    ],
  );

  return (
    <PdpPurchaseContext.Provider value={value}>
      {children}
    </PdpPurchaseContext.Provider>
  );
}

export function usePdpPurchase(): PdpPurchaseContextValue {
  const value = useContext(PdpPurchaseContext);
  if (!value) {
    throw new Error("usePdpPurchase must be used within PdpPurchaseProvider");
  }
  return value;
}
