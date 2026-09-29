import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SECTION_REGISTRY } from "./sectionRegistry";
import type { HomepageSection } from "@/lib/api";

const section: HomepageSection = {
  id: "00000000-0000-7000-8000-000000000201",
  type: "USP",
  title: null,
  subtitle: null,
  sortOrder: 10,
  style: {
    backgroundColor: "#112233",
    textColor: "#fefefe",
    contentWidth: "NARROW",
    paddingTop: 18,
    paddingBottom: 26,
  },
  payload: { items: [{ icon: "shield", label: "Nationwide delivery" }] },
};

describe("homepage section style rendering", () => {
  it("applies persisted section presentation styles to the storefront shell", () => {
    const Section = SECTION_REGISTRY.USP;
    const { container } = render(<Section section={section} />);
    const shell = container.querySelector("section");

    expect(shell).toHaveStyle({
      backgroundColor: "#112233",
      color: "#fefefe",
      paddingTop: "18px",
      paddingBottom: "26px",
    });
    expect(shell).toHaveClass("max-w-[840px]");
  });
});
