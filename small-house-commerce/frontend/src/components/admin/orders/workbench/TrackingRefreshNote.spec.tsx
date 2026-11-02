import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrackingRefreshNote } from "./TrackingRefreshNote";

describe("TrackingRefreshNote", () => {
  it("announces a successful refresh", () => {
    render(
      <TrackingRefreshNote feedback={{ ok: true, message: "3 new scans" }} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("3 new scans");
  });

  it("raises a failed refresh as an alert", () => {
    render(
      <TrackingRefreshNote
        feedback={{ ok: false, message: 'Shipment carrier "LBC" is not handled' }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      'Shipment carrier "LBC" is not handled',
    );
  });

  it("renders nothing before anyone refreshes", () => {
    const { container } = render(<TrackingRefreshNote feedback={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
