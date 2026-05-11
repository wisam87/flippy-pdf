# Publishing flippy-pdf to npmjs.com

A step-by-step guide for getting this package onto
[npmjs.com](https://npmjs.com) so anyone can install it with
`npm install flippy-pdf`.

---

## 0. Confirm the name is still available

The package is named `flippy-pdf` (in `package.json`). Before you publish,
double-check the name isn't taken on npm:

```bash
npm view flippy-pdf
# → 404 means available; otherwise pick another name
# Or just visit:
#   https://www.npmjs.com/package/flippy-pdf
```

If `flippy-pdf` is taken, the easiest fallback is a scoped name under
your own npm username — those are always available:

```bash
# In package.json, change "name": "flippy-pdf" to:
"name": "@mwisam/flippy-pdf"
```

Scoped packages require `--access public` on first publish (see §7).

---

## 1. Create an npm account

If you don't have one:

1. Go to <https://www.npmjs.com/signup>.
2. Pick a username (this is your npm handle and your scope name).
3. Verify your email — **you can't publish until email is verified.**

---

## 2. Enable two-factor auth (strongly recommended)

npm has had supply-chain incidents — turn 2FA on before you publish.

1. <https://www.npmjs.com/settings/~/tfa>
2. Choose **"Authorization and writes"** (requires 2FA for publish *and*
   for changing account settings).
3. Save the recovery codes somewhere safe.

---

## 3. Log in from the terminal

```bash
npm login
```

This opens a browser, authenticates you, and writes an auth token to
`~/.npmrc`. Verify:

```bash
npm whoami
# → mwisam
```

> **CI/CD**: don't use `npm login` on a build server. Create an
> [automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
> and expose it as `NPM_TOKEN`, then add this to your CI environment:
>
> ```bash
> echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc
> ```

---

## 4. Pre-publish checklist

Run through this before every release. Most of it is one-time, but the
build/lint steps run on every version.

- [ ] `package.json` has a unique, valid `name`.
- [ ] `version` follows [semver](https://semver.org) (more below).
- [ ] `description` is set and is one sentence.
- [ ] `repository`, `bugs`, `homepage`, `author`, `license` filled in.
- [ ] `main`, `module`, and `exports` resolve to real files. Verify with:
      `node -e "import('./src/index.js').then(m => console.log(Object.keys(m)))"`
- [ ] `files` lists everything that should ship (and nothing that shouldn't).
- [ ] `README.md` renders well on npmjs.com (basic Markdown — no GitHub
      callouts).
- [ ] `LICENSE` exists.
- [ ] `.npmignore` or the `files` field excludes: `node_modules/`,
      `dist/` if it's not a build artifact you want shipped, the demo PDF,
      and test fixtures.
- [ ] No secrets in `.env` or anywhere else.
- [ ] Do a dry run (see step 6).

---

## 5. Versioning

npm uses [semver](https://semver.org): `MAJOR.MINOR.PATCH`.

| Change                     | Bump      | Command                |
| -------------------------- | --------- | ---------------------- |
| Backwards-incompatible API | MAJOR     | `npm version major`    |
| New feature, no breakage   | MINOR     | `npm version minor`    |
| Bug fix, no API change     | PATCH     | `npm version patch`    |
| Pre-release                | tag       | `npm version 0.2.0-beta.1` |

`npm version <type>` updates `package.json`, creates a git commit and a
git tag (`v0.2.0`), so you can `git push --follow-tags` afterwards.

---

## 6. Dry run — see exactly what will be uploaded

This is the most important defensive step. **Always do it before publishing.**

```bash
npm pack --dry-run
```

You'll see something like:

```
npm notice 📦  flippy-pdf@0.1.0
npm notice === Tarball Contents ===
npm notice 5.2kB  LICENSE
npm notice 8.5kB  README.md
npm notice 28kB   src/flipbook.js
npm notice 8kB    src/flipbook.css
npm notice 0.2kB  src/index.js
npm notice 1kB    package.json
...
```

Look for:
- **Anything you don't want shipped** (the 33MB sample PDF, screenshots,
  test snapshots). Add them to `.npmignore` or tighten the `files` field.
- **Total package size.** Aim for under a few hundred KB; multi-MB packages
  annoy people who install them.

For an actual tarball you can inspect with `tar tvf`:

```bash
npm pack
tar tvf flippy-pdf-0.1.0.tgz
rm flippy-pdf-0.1.0.tgz   # don't commit it
```

---

## 7. Publish

### First publish

```bash
# Public package (no scope, or a public-scoped package)
npm publish --access public

# After it succeeds, npm prompts for a 2FA OTP — type it.
```

If your package is scoped (`@you/name`), `--access public` is required —
otherwise npm assumes scoped = private (paid).

### Subsequent releases

```bash
npm version patch        # 0.1.0 → 0.1.1
npm publish
git push --follow-tags   # push the version commit + tag to GitHub
```

### Test the published package

```bash
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install flippy-pdf
node -e "import('flippy-pdf').then(m => console.log(Object.keys(m)))"
# → [ 'Flipbook', 'default', 'setWorkerSrc' ]
```

---

## 8. After publishing

- **The package page** appears at
  `https://www.npmjs.com/package/<name>` within a minute. Your README
  becomes the body of the page.
- **`npm view <name>`** shows the published metadata.
- You **cannot delete** a version after 72 hours — npm enforces this to
  protect downstream installs. Within 72 hours, `npm unpublish` works.
- **`npm deprecate <name>@<version> "reason"`** is the right tool for
  retiring a broken or insecure release. Users will see the warning on
  install but existing installs keep working.

---

## 9. Common pitfalls

- **"402 Payment Required"** when publishing a scoped package — you forgot
  `--access public`.
- **"403 Forbidden — package name too similar"** — npm flagged a typo
  squatting risk. Pick a more distinctive name.
- **The CSS file isn't in the tarball** — check the `files` field in
  `package.json`. `src` should be listed.
- **The published package is huge** — open the tarball with `npm pack` and
  see what's in it. Almost always: `node_modules` (shouldn't be there) or
  build artifacts.
- **Worker isn't loading for consumers** — they need to call
  `setWorkerSrc(...)` or accept the CDN default. Document this in your
  README (already done in this repo).
- **Forgot to `git push --follow-tags`** — npm has the release but GitHub
  doesn't. Run `git push --tags`.

---

## 10. Optional: automate releases with GitHub Actions

Once you're publishing more than occasionally, automate it. Save this as
`.github/workflows/release.yml`:

```yaml
name: Release to npm
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # for npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Push a tag (`git tag v0.2.0 && git push --tags`) and the workflow
publishes. `--provenance` attests to where the package was built, which
is now showing up as a green badge on npm package pages.

---

## TL;DR

```bash
# One-time
npm login                            # auth
# Per release
npm pack --dry-run                   # see what will ship
npm version patch                    # bump
npm publish --access public          # send it
git push --follow-tags               # mirror to GitHub
```

Good luck shipping.
