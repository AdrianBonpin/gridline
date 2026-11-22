# 42: Production CSP and least-privilege capabilities

**What to build:** A packaged build runs under a restrictive content security policy with only the webview capabilities it needs, so renderer-executed code has a constrained blast radius.

**Blocked by:** None (can start immediately)

**Seams:** Built-product seam: catches the policy in a production bundle and that the app still functions; misses hypothetical future renderer code.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/87
**Status:** done

- [x] A packaged production build loads and all primary flows work under the configured policy.
- [x] Editor styling and workers required by the editor function under the policy.
- [x] IPC remains functional while unnecessary remote connections are disallowed.
- [x] Renderer access to unused plaintext keyring export and unused opener powers is removed.
- [x] The policy is verified in a production build, with the development-mode gap documented.
