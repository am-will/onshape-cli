# npm candy cane demo

This demo tests the published npm package, not the local source tree. It builds a
single cylindrical candy cane from high-level commands and validates the final
Part Studio.

- Package: `onshape@0.1.1`
- Installed from: `https://registry.npmjs.org/onshape/-/onshape-0.1.1.tgz`
- Verified registry-tarball demo:
  https://cad.onshape.com/documents/5acf397cea2f1305d992213c/w/b29c1d84b0a776e16c82fa1b/e/67e42bb46877b3bbe85fd43b

Run it:

```bash
npm install
npm run demo
```

Commands exercised by `run-high-level-candy-cane.sh`:

```bash
npx onshape create-document --name "NPM 0.1.1 Candy Cane Demo ..." --public
npx onshape get-elements --doc ... --ws ...
npx onshape sketch-circle --plane Top --center 0.95,0 --radius 0.16
npx onshape extrude --sketch ... --depth 4.05 --op NEW
npx onshape sketch-circle-axis --plane Front --center 0.95,3.9 --radius 0.16 \
  --axis-start -0.05,2.6 --axis-end -0.05,5.3
npx onshape revolve --sketch ... --angle 205 --op ADD
npx onshape validate-partstudio --expect-parts 1 --expect-bodies 1
```

Verified result:

- Each created feature returned post-add validation status `OK`.
- Final feature list: `Stem circular profile`, `Straight cylindrical stem`,
  `Hook circular profile and revolve axis`, `Curved cylindrical hook`.
- `validate-partstudio` returned `parts: 1`, `bodies: 1`.

Note: this local npm installation uses the tarball URL because this machine has an
npm release-age/date gate that temporarily hides packages published after
May 29, 2026 from normal `npm install onshape@0.1.1`.
