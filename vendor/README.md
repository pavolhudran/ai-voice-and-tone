# Vendored libraries

Third-party extraction code, committed as pinned bytes.

**Why committed and not depended on.** The plugin's guarantee is that the same
document fingerprints identically on every machine — otherwise two people
derive different voice rules from the same corpus. A system tool is absent on
half of them; an npm dependency drifts between installs. A pinned bundle in the
repository is byte-identical for everyone.

| Library | Version | License | Used for |
|---|---|---|---|
| pdfjs-dist | 4.10.38 | Apache-2.0 | PDF text |
| officeparser | 7.8.0 | MIT | docx, pptx, xlsx, odt, odp, ods |

OCR (`tesseract.js`) is deliberately excluded: scanned documents go to the model
tier, which reads them with vision and marks the result `estimated`.

**To update:** bump the version in `scripts/vendor.mjs`, run `npm run vendor`,
review the diff, commit. `test/vendor.test.mjs` verifies the committed bytes
match the manifest's hashes.

**After any bump, every source extracted by the changed library must be marked
stale** so its numbers are recomputed rather than silently shifting. Each index
entry records which extractor and version produced it for exactly this reason.

`scripts/vendor.mjs` only ever removes what it owns - the `pdfjs/` and
`officeparser/` subdirectories and `manifest.json` - so this file and anything
else placed directly under `vendor/` survive a rebuild untouched.
