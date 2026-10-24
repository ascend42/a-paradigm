# @a-company/gnomon-darwin-arm64

The signed, notarized `Gnomon.app` for macOS on arm64, as a `ditto` zip plus its sha256. npm installs it automatically as an optional dependency of `@a-company/gnomon` (and so of `@a-company/paradigm` 8) on a matching Mac; there is no reason to install it directly.

The zip is built and signed on the release Mac by `packages/gnomon/scripts/release-darwin.mjs`, which copies it here; the repository never tracks it.

```js
import { zipPath, sha256Path, verifyZip } from '@a-company/gnomon-darwin-arm64';
```
