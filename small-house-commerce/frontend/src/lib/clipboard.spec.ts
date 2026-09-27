import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

function setClipboard(value: { writeText(text: string): Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

function setExecCommand(implementation: (command: string) => boolean) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(implementation),
  });
  return document.execCommand as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("copies through the native Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);

    await expect(copyText("https://luwag.ph/products/chair")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("https://luwag.ph/products/chair");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("uses a selected hidden textarea when the Clipboard API is unavailable", async () => {
    setClipboard(undefined);
    const execCommand = setExecCommand((command) => {
      expect(command).toBe("copy");
      const textarea = document.activeElement;
      expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
      expect((textarea as HTMLTextAreaElement).value).toBe("copy over http");
      expect((textarea as HTMLTextAreaElement).selectionStart).toBe(0);
      expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(
        "copy over http".length,
      );
      return true;
    });

    await expect(copyText("copy over http")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector("textarea[aria-hidden='true']")).toBeNull();
  });

  it("falls back once when the native Clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied"));
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);

    await expect(copyText("fallback value")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both native and fallback copying fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied"));
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => false);

    await expect(copyText("manual copy required")).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector("textarea[aria-hidden='true']")).toBeNull();
  });

  it("does not repeat a successful clipboard write or invoke the fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);

    await copyText("one click, one copy");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledTimes(0);
  });
});
