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

  /** @param {{elementId: string}} element */
  async click(element) {
    await this.#request(
      "POST",
      this.#sessionPath(`/element/${element.elementId}/click`),
      {},
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
