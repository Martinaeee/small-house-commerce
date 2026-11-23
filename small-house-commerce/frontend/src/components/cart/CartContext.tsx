// src/components/cart/CartContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  cartStorage,
  type CartItem,
  type CartSummary,
  type Product,
} from "@/lib/api";
import { removeCartLines } from "@/lib/cart-cleanup";

/**
 * Single source of truth for the guest cart on the client (Shopee/Taobao
 * pattern). PDP add-to-cart, the cart page, checkout and the header badge all
 * read/mutate the same CartSummary: mutators optimistically replace state
 * with the summary the API returns, so the badge and pages never refetch.
 * Cross-tab changes to the cartId key trigger a reload.
 */
export type DrawerView = "cart" | "picker" | "change" | "added";

/**
 * What the picker view does once the shopper confirms a combination. ADD TO
 * CART (the default) adds the line; ORDER NOW hands the same combination to
 * checkout, so the PDP's two actions share one picker.
 */
export type PickerIntent = "ADD_TO_CART" | "ORDER_NOW";

interface CartContextValue {
  cart: CartSummary | null;
  loading: boolean;
  /**
   * F01: the last cart read failed. The last valid cart (when there was one)
   * stays in `cart`; the UI must show a retry instead of pretending the cart
   * is empty. Null means the current cart state is trustworthy.
   */
  error: string | null;
  isOpen: boolean;
  view: DrawerView;
  pickerProduct: Product | null;
  /**
   * Variant the picker view starts on. The PDP hands over its current
   * selection so the drawer opens on the combination the shopper already
   * chose; null starts unselected (PLP and cart quick-add).
   */
  pickerInitialVariantId: string | null;
  /** Quantity the picker view starts on; null means the default of 1. */
  pickerInitialQuantity: number | null;
  /** What the picker view confirms into (add to cart, or straight to checkout). */
  pickerIntent: PickerIntent;
  /** The cart line whose options are being changed (view === "change"). */
  changeTarget: CartItem | null;
  /** Open the drawer in the variant-picker view for the given product. */
  openPicker: (
    product: Product,
    options?: {
      initialVariantId?: string | null;
      initialQuantity?: number;
      intent?: PickerIntent;
    },
  ) => void;
  /**
   * Open the drawer in the Change Options view for the given cart line.
   * Usable from the drawer's own cart view or from the cart page.
   */
  openChangeOptions: (item: CartItem) => void;
  /** Switch an open drawer back to the cart view (after a picker resolves). */
  goToCartView: () => void;
  /** Show the "Added to cart" confirmation in the same drawer. */
  showAddedView: () => void;
  openCart: () => void;
  closeCart: () => void;
  /** Consume (and clear) the element focused when the drawer was requested. */
  takeDrawerOpener: () => HTMLElement | null;
  /** Replace state with an API-returned summary (add-to-cart response). */
  applySummary: (summary: CartSummary) => void;
  reload: () => Promise<void>;
  addItem: (
    input: { skuId: string; quantity: number },
    opts?: { openDrawer?: boolean },
  ) => Promise<CartSummary>;
  updateItem: (itemId: string, quantity: number) => Promise<CartSummary>;
  /**
   * Atomically replace a line's SKU (Change Options confirm). Adopts the
   * merged summary on success; on failure throws without touching state, so
   * the cart is preserved for an error announcement + retry.
   */
  replaceItem: (input: {
    itemId: string;
    skuId: string;
    quantity: number;
  }) => Promise<CartSummary>;
  removeItem: (itemId: string) => Promise<CartSummary>;
  /** Delete the given lines one by one (partial checkout) then resync. */
  removeItems: (itemIds: readonly string[]) => Promise<void>;
  /** Distinct product count used by the header badge. */
  itemKindCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<DrawerView>("cart");
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [pickerInitialVariantId, setPickerInitialVariantId] = useState<
    string | null
  >(null);
  const [pickerInitialQuantity, setPickerInitialQuantity] = useState<
    number | null
  >(null);
  const [pickerIntent, setPickerIntent] = useState<PickerIntent>("ADD_TO_CART");
  const [changeTarget, setChangeTarget] = useState<CartItem | null>(null);
  // Captured synchronously in the add-to-cart click task — before the busy
  // rerender disables the trigger and Chrome moves focus to <body> — and
  // consumed once by the drawer's open effect for focus restoration.
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const captureOpener = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      drawerOpenerRef.current = active;
    }
  }, []);
  const openCart = useCallback(() => {
    captureOpener();
    setPickerProduct(null);
    setPickerInitialVariantId(null);
    setPickerInitialQuantity(null);
    setPickerIntent("ADD_TO_CART");
    setChangeTarget(null);
    setView("cart");
    setIsOpen(true);
  }, [captureOpener]);
  const openPicker = useCallback(
    (
      product: Product,
      options?: {
        initialVariantId?: string | null;
        initialQuantity?: number;
        intent?: PickerIntent;
      },
    ) => {
      captureOpener();
      setPickerProduct(product);
      setPickerInitialVariantId(options?.initialVariantId ?? null);
      setPickerInitialQuantity(options?.initialQuantity ?? null);
      setPickerIntent(options?.intent ?? "ADD_TO_CART");
      setChangeTarget(null);
      setView("picker");
      setIsOpen(true);
    },
    [captureOpener],
  );
  const openChangeOptions = useCallback(
    (item: CartItem) => {
      captureOpener();
      setPickerProduct(null);
      setPickerInitialVariantId(null);
      setPickerInitialQuantity(null);
      setChangeTarget(item);
      setView("change");
      setIsOpen(true);
    },
    [captureOpener],
  );
  const goToCartView = useCallback(() => {
    setChangeTarget(null);
    setView("cart");
  }, []);
  const showAddedView = useCallback(() => {
    setChangeTarget(null);
    setView("added");
  }, []);
  const closeCart = useCallback(() => {
    setIsOpen(false);
    setPickerProduct(null);
    setPickerInitialVariantId(null);
    setPickerInitialQuantity(null);
    setChangeTarget(null);
    setView("cart");
  }, []);
  const takeDrawerOpener = useCallback(() => {
    const el = drawerOpenerRef.current;
    drawerOpenerRef.current = null;
    return el;
  }, []);

  const reload = useCallback(async () => {
    const id = cartStorage.get();
    if (!id) {
      setCart(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const summary = await api.getCart(id);
      setCart(summary);
      setError(null);
      // An empty summary means a stale cart id.
      if (summary.items.length === 0) cartStorage.set("");
    } catch {
      // F01: a failed read (network, 502, timeout) must not wipe the cart the
      // shopper already has. Keep the last valid summary and surface a retry.
      setError("We couldn't load your cart. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — setState only after the fetch (same pattern as
  // AuthProvider; react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = cartStorage.get();
      try {
        const summary = id ? await api.getCart(id) : null;
        if (!alive) return;
        setLoading(false);
        if (summary) {
          setCart(summary);
          setError(null);
          // An empty summary means a stale cart id.
          if (summary.items.length === 0) cartStorage.set("");
        } else {
          setCart(null);
          setError(null);
        }
      } catch {
        if (!alive) return;
        // Keep whatever cart we already had; never present a failed read as
        // "Your cart is empty".
        setError("We couldn't load your cart. Please check your connection and try again.");
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Cross-tab cart sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "cartId") void reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  const applySummary = useCallback((summary: CartSummary) => {
    cartStorage.set(summary.cartId);
    setCart(summary);
  }, []);

  const addItem = useCallback(
    async (
      { skuId, quantity }: { skuId: string; quantity: number },
      opts?: { openDrawer?: boolean },
    ) => {
      const willOpen = opts?.openDrawer !== false;
      // Still the same click task and the trigger is focused here; after the
      // await the disabled rerender has moved focus to <body> (FAIL-1). When
      // the drawer stays closed (quick-add inside it) the ref is never touched.
      if (willOpen) {
        const active = document.activeElement;
        drawerOpenerRef.current =
          active instanceof HTMLElement && active !== document.body ? active : null;
      }
      try {
        const summary = await api.addToCart({ cartId: cartStorage.get(), skuId, quantity });
        cartStorage.set(summary.cartId);
        setCart(summary);
        if (willOpen) setIsOpen(true);
        if (willOpen) {
          // The confirmation, not the cart list, is what an add opens. The
          // footer of that view offers "Go to cart" for the checkout path.
          setChangeTarget(null);
          setView("added");
        }
        return summary;
      } catch (err) {
        if (willOpen) drawerOpenerRef.current = null;
        throw err;
      }
    },
    [],
  );

  const updateItem = useCallback(async (itemId: string, quantity: number) => {
    const id = cartStorage.get();
    if (!id) throw new Error("No active cart");
    const summary = await api.updateCartItem(id, itemId, quantity);
    setCart(summary);
    return summary;
  }, []);

  const replaceItem = useCallback(
    async ({
      itemId,
      skuId,
      quantity,
    }: {
      itemId: string;
      skuId: string;
      quantity: number;
    }) => {
      const id = cartStorage.get();
      if (!id) throw new Error("No active cart");
      // Adopt only on success: a rejected replace throws before setCart, so
      // the drawer/picker can announce the error over the preserved cart.
      const summary = await api.replaceCartItem(id, itemId, { skuId, quantity });
      setCart(summary);
      return summary;
    },
    [],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      const id = cartStorage.get();
      if (!id) throw new Error("No active cart");
      const summary = await api.removeCartItem(id, itemId);
      setCart(summary);
      if (summary.items.length === 0) cartStorage.set("");
      return summary;
    },
    [],
  );

  const removeItems = useCallback(
    async (itemIds: readonly string[]) => {
      const id = cartStorage.get();
      if (!id || itemIds.length === 0) return;
      // Remove line by line so one bad line cannot keep the rest in the cart.
      // A 404 means the line is already gone (the caller is retrying after a
      // partial failure), which counts as success.
      const failed = await removeCartLines((itemId) => api.removeCartItem(id, itemId), itemIds);
      await reload();
      if (failed.length > 0) {
        throw new Error(`${failed.length} cart item(s) could not be removed`);
      }
    },
    [reload],
  );

  const itemKindCount = useMemo(
    () => new Set(cart?.items.map((item) => item.productSlug) ?? []).size,
    [cart],
  );

  const value: CartContextValue = {
    cart,
    loading,
    error,
    isOpen,
    view,
    pickerProduct,
    pickerInitialVariantId,
    pickerInitialQuantity,
    pickerIntent,
    changeTarget,
    openPicker,
    openChangeOptions,
    goToCartView,
    showAddedView,
    openCart,
    closeCart,
    takeDrawerOpener,
    applySummary,
    reload,
    addItem,
    updateItem,
    replaceItem,
    removeItem,
    removeItems,
    itemKindCount,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

function rejectPreviewAction(): never {
  throw new Error("Preview does not allow cart changes.");
}

const previewCart: CartContextValue = {
  cart: null, loading: false, error: null, isOpen: false, view: "cart",
  pickerProduct: null, pickerInitialVariantId: null, pickerInitialQuantity: null,
  pickerIntent: "ADD_TO_CART",
  changeTarget: null, itemKindCount: 0,
  openPicker: rejectPreviewAction, openChangeOptions: rejectPreviewAction,
  goToCartView: rejectPreviewAction, showAddedView: rejectPreviewAction,
  openCart: rejectPreviewAction, closeCart: rejectPreviewAction,
  takeDrawerOpener: () => null, applySummary: rejectPreviewAction,
  reload: rejectPreviewAction, addItem: rejectPreviewAction, updateItem: rejectPreviewAction,
  replaceItem: rejectPreviewAction, removeItem: rejectPreviewAction, removeItems: rejectPreviewAction,
};

export function CartPreviewProvider({ children }: { children: ReactNode }) {
  return <CartContext.Provider value={previewCart}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
