# 45: macOS signing fails closed

**What to build:** A macOS release without working signing and notarization credentials fails instead of uploading an artifact that is merely ad-hoc signed.

**Blocked by:** 43

**Seams:** Built-product seam: catches workflow gating and post-build verification; final notarization confirmation still requires the real release job.

**Tracker:** https://github.com/AdrianBonpin/gridline/issues/102
**Status:** done

- [x] Missing signing or notarization credentials fail the release job.
- [x] The built application and disk image are verified after signing and stapling.
- [x] Verification failure prevents upload.
- [x] The published security claim matches what the pipeline guarantees.
