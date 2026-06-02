# npm candy cane demo

This demo tests the published npm package, not the local source tree. It builds a
single cylindrical candy cane from high-level commands and validates the final
Part Studio.

- Package: `onshape@0.1.2`
- Installed from: `https://registry.npmjs.org/onshape/-/onshape-0.1.2.tgz`
- Verified local-source visual demo:
  https://cad.onshape.com/documents/361fd5d116bd4ae01d2008e3/w/231d0530755e9680d92b5d1c/e/eceef4d374da2008fcf9d19c

Run it:

```bash
npm install
npm run demo
```

Commands exercised by `run-high-level-candy-cane.sh`:

```bash
npx onshape create-document --name "NPM 0.1.2 Candy Cane Demo ..." --public
npx onshape get-elements --doc ... --ws ...
npx onshape sketch-circle --plane Top --center 0.95,0 --radius 0.16
npx onshape sketch-candy-cane-path --plane Front --x 0.95 --straight-height 4.05 \
  --hook-radius 1.0 --hook-angle 210
npx onshape sweep --profile ... --path ... --op NEW
npx onshape offset-plane --base-plane Top --offset ...
npx onshape sketch-circle --plane-feature ... --radius 0.19
npx onshape extrude --sketch ... --depth 0.22 --op ADD
npx onshape create-feature-studio --name "Candy cane appearance"
npx onshape set-feature-studio --contents-file out/candy-appearance.fs
npx onshape get-feature-studio-specs --elem ...
npx onshape add-feature --json-file out/07-add-appearance.json
npx onshape validate-partstudio --expect-parts 1 --expect-bodies 1
```

Verified result:

- Each created feature returned post-add validation status `OK`.
- Final geometry is a continuous swept cylindrical cane with raised red sleeve bands
  on a white base.
- `validate-partstudio` returned `parts: 1`, `bodies: 1`.

Note: this local npm installation uses the tarball URL because this machine has an
npm release-age/date gate that temporarily hides packages published after
May 29, 2026 from normal `npm install onshape@0.1.2`.
