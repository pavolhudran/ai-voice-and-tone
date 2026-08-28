---
description: Register brand material, see what has already been analysed, and ingest what is new
argument-hint: "[<path|url>] [--inbox] [--refresh] [--forget <id>]"
---

# /voice-and-tone:connect

Brand material is an input, not an artifact. Drop files into
`.voice-and-tone/sources/`, or point at anything on disk or on the web. Nothing
you add is committed; what survives is `evidence/sources.json`, the record of
exactly what has been analysed.

## Usage

```
/voice-and-tone:connect                  what is new, changed, or missing
/voice-and-tone:connect <path>           register a file or folder, anywhere on disk
/voice-and-tone:connect <url>            register and fetch a page
/voice-and-tone:connect --inbox          analyse everything newly dropped in
/voice-and-tone:connect --refresh [<id>] re-fetch URLs, re-extract changed files
/voice-and-tone:connect --forget <id>    retract a source and reopen its rules
```

## What it reads

Deterministically, with no dependencies: Markdown, plain text, JSON, YAML, PO,
HTML, RTF, CSV/TSV, WebVTT/SubRip, `.docx`, `.pptx`, `.xlsx`, `.odt`, `.odp`,
`.ods`, and PDFs with a text layer.

Scanned PDFs, images, and JS-rendered pages are read by the model instead, and
are recorded as `estimated` - they can support `assumed` rules but never
`derived` ones.

`.doc`, `.ppt`, and `.xls` are refused: re-save them as the modern format.

## Invokes

The `voice-discovery` skill.

$ARGUMENTS
