import { HarnessError, errorMessage } from "./errors.mjs";

/** W3C "Web element reference" key used by every conforming driver. */
export const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export class WebDriverError extends HarnessError {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = "WebDriverError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Minimal W3C WebDriver client.
 *
 * Deliberately dependency-free: the harness talks HTTP to `tauri-driver`
 * itself instead of pulling a full WebDriver/Selenium stack into the
 * workspace, so the desktop dependency graph (and its audit surface) is
 * unchanged. Only the commands the built-product smoke needs are implemented.
 */
export class WebDriverClient {
  /**
   * @param {{baseUrl: string, fetchImpl?: typeof fetch}} options
   */
  constructor({ baseUrl, fetchImpl = globalThis.fetch }) {
    if (!baseUrl) throw new HarnessError("WebDriverClient requires a baseUrl");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    /** @type {string | null} */
    this.sessionId = null;
  }

  async createSession(capabilities) {
    const value = await this.#request("POST", "/session", { capabilities });
    const sessionId = value?.sessionId;
    if (!sessionId) {
      throw new WebDriverError("driver accepted /session without returning a sessionId");
    }
    this.sessionId = sessionId;
    return sessionId;
  }

  async deleteSession() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.#request("DELETE", `/session/${sessionId}`);
  }

  /**
   * @param {string} cssSelector
   * @returns {Promise<{elementId: string} | null>} null when nothing matches yet
   */
  async findElement(cssSelector) {
    try {
      const value = await this.#request("POST", this.#sessionPath("/element"), {
        using: "css selector",
        value: cssSelector,
      });
      const elementId = value?.[ELEMENT_KEY];
      if (!elementId) {
        throw new WebDriverError(
          `driver returned no element reference for selector ${cssSelector}`,
        );
      }
      return { elementId };
    } catch (error) {
      if (error instanceof WebDriverError && error.code === "no such element") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Every element matching a CSS selector. An empty list means "nothing yet"
   * (the W3C spec answers 200 with `[]`), so callers can poll it safely.
   *
   * @param {string} cssSelector
   * @returns {Promise<Array<{elementId: string}>>}
   */
  async findElements(cssSelector) {
    const value = await this.#request("POST", this.#sessionPath("/elements"), {
      using: "css selector",
      value: cssSelector,
    });
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      const elementId = entry?.[ELEMENT_KEY];
      return elementId ? { elementId } : null;
    }).filter((entry) => entry !== null);
  }

  /**
   * Read an element attribute (`null` when the attribute is absent).
   *
   * This is the assertion source the harness needs: WebKitWebDriver's `/text`
   * endpoint only returns inline content, so block-level grid cells report ""
   * while their `title` attribute holds the rendered value.
   *
   * @param {{elementId: string}} element
   * @param {string} name
   * @returns {Promise<string | null>}
   */
  async getAttribute(element, name) {
    const value = await this.#request(
      "GET",
      this.#sessionPath(`/element/${element.elementId}/attribute/${encodeURIComponent(name)}`),
    );
    return value == null ? null : String(value);
  }

  /** @param {{elementId: string}} element */
  async click(element) {
    await this.#request(
      "POST",
      this.#sessionPath(`/element/${element.elementId}/click`),
      {},
    );
  }

  /**
   * Type `text` into an element (`POST /element/{id}/value`).
   *
   * W3C requires both `text` and a per-character `value` array; drivers differ
   * on which one they honour, so both are sent. The element must already hold
   * focus — click it first.
   *
   * @param {{elementId: string}} element
   * @param {string} text
   */
  async sendKeys(element, text) {
    await this.#request(
      "POST",
      this.#sessionPath(`/element/${element.elementId}/value`),
      { text, value: Array.from(text) },
    );
  }

  /** @param {{elementId: string}} element */
  async elementText(element) {
    const value = await this.#request(
      "GET",
      this.#sessionPath(`/element/${element.elementId}/text`),
    );
    return value == null ? "" : String(value);
  }

  /** @returns {Promise<string>} base64-encoded PNG */
  async screenshot() {
    const value = await this.#request("GET", this.#sessionPath("/screenshot"));
    return String(value ?? "");
  }

  async pageSource() {
    const value = await this.#request("GET", this.#sessionPath("/source"));
    return String(value ?? "");
  }

  #sessionPath(suffix) {
    if (!this.sessionId) throw new HarnessError("no WebDriver session is open");
    return `/session/${this.sessionId}${suffix}`;
  }

  async #request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new WebDriverError(
        `WebDriver request failed (${method} ${path}): ${errorMessage(error)}`,
      );
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const value = payload?.value;

    if (!response.ok || (value && typeof value === "object" && value.error)) {
      const code = value && typeof value === "object" ? value.error : null;
      const message = value && typeof value === "object" ? value.message : null;
      throw new WebDriverError(
        code || message
          ? `${code ?? "error"}: ${message ?? "no message"} (${method} ${path})`
          : `WebDriver request failed with HTTP ${response.status} (${method} ${path})`,
        { code: code ?? null, status: response.status },
      );
    }
    return value;
  }
}
