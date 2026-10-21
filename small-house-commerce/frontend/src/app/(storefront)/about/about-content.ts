/**
 * About Us page content.
 *
 * Everything the page shows lives here — copy, photography and links — so the
 * brand story can be edited in one place instead of being spread across the
 * markup. The order is fixed by the approved design: Our Story → Why Luwag →
 * Our Promise → Shopping With Confidence → Explore the Collection.
 *
 * The service promises under "Shopping With Confidence" follow the policy the
 * store already publishes: nationwide delivery with a delivery estimate, cash
 * on delivery, and the 7-day free return & exchange shown on every product
 * page. Nothing here promises a delivery day the site cannot keep.
 */

export type AboutIcon = "home" | "box" | "heart" | "truck" | "bag" | "return" | "chat";

export type AboutValue = {
  icon: AboutIcon;
  title: string;
  body: string;
};

export type AboutStep = {
  image: string;
  imageAlt: string;
  title: string;
  body: string;
};

export type AboutService = {
  icon: AboutIcon;
  title: string;
  body: string;
};

export const ABOUT_CONTENT = {
  story: {
    eyebrow: "Our story",
    headingLines: ["More room", "for living."],
    body: "At Luwag, we believe a comfortable home isn't about having more space. It's about making more of the space you have.",
    image: "/about/our-story.jpg",
    imageAlt:
      "A Luwag living room: cream sofa with sage cushions, round oak coffee table and plants by the window",
  },
  why: {
    eyebrow: "Why Luwag",
    headingLines: ["Less clutter.", "More living."],
    body: "We started Luwag with a simple idea — thoughtful furniture can help real homes feel more open, organized, and comfortable, even in small spaces.",
    image: "/about/why-luwag.jpg",
    imageAlt:
      "A wooden dining table with rattan chairs by a window, plants on the sill and open shelving behind",
    values: [
      {
        icon: "home",
        title: "Designed for real homes",
        body: "Thoughtful solutions for everyday spaces.",
      },
      {
        icon: "box",
        title: "Practical & versatile",
        body: "Furniture that works a little harder for your home.",
      },
      {
        icon: "heart",
        title: "A more comfortable everyday",
        body: "Because a well-organized home feels lighter.",
      },
    ] as AboutValue[],
  },
  promise: {
    eyebrow: "Our promise",
    headingLines: ["Thoughtful", "quality, from start", "to your home."],
    body: "We believe good design starts with thoughtful choices. From materials to production and packaging, every detail matters in creating furniture made for everyday living.",
    /**
     * The design has a "Our manufacturing →" button, but the site has no
     * manufacturing page to point at. The button is rendered without a
     * destination until a target is confirmed — a dead link would be worse
     * than a pending one.
     */
    cta: { label: "Our manufacturing", href: null as string | null },
    /**
     * The three production photographs are placeholders for real workshop,
     * packing and warehouse photography. They must be replaced with the
     * brand's own production records before the page is used as a claim about
     * how the furniture is actually made.
     */
    steps: [
      {
        image: "/about/promise-materials.jpg",
        imageAlt: "A furniture workshop with raw boards stacked on pallets",
        title: "Carefully selected materials",
        body: "We choose practical materials suited for everyday homes.",
      },
      {
        image: "/about/promise-quality.jpg",
        imageAlt: "A worker taping a packed box in the workshop",
        title: "Skilled production & quality checks",
        body: "Every piece is carefully made and checked before it reaches you.",
      },
      {
        image: "/about/promise-delivery.jpg",
        imageAlt: "Luwag-branded cartons stacked on pallets in the warehouse",
        title: "Secure packaging & delivery",
        body: "We pack each order with care to help protect it during delivery.",
      },
    ] as AboutStep[],
  },
  confidence: {
    eyebrow: "Shopping with confidence",
    headingLines: ["Good living should feel simple."],
    image: "/about/confidence-boxes.jpg",
    imageAlt: "Luwag cartons by a sunlit window with plants",
    services: [
      { icon: "truck", title: "Fast delivery", body: "Clear delivery estimates." },
      { icon: "bag", title: "Easy checkout", body: "COD available." },
      {
        icon: "return",
        title: "7-Day Returns & Exchanges",
        body: "Shop with peace of mind.",
      },
      { icon: "chat", title: "Customer Support", body: "Here to help." },
    ] as AboutService[],
  },
  collection: {
    eyebrow: "Make room for what matters",
    headingLines: ["Explore the collection."],
    image: "/about/collection-bedroom.jpg",
    imageAlt:
      "A calm bedroom with cream bedding, a deep green throw, oak nightstand and plants by the window",
    cta: { label: "Shop now", href: "/collections/new-arrivals" },
  },
} as const;
