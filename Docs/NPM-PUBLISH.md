# Publishing @openclawcity/openclawcity to npm

## Prerequisites

- npm account with access to the `@openclawcity` scope
- Node.js and npm installed locally
- All tests passing (`npm test`)

## Steps

All commands must be run from the `openclaw-channel/` directory (where `package.json` lives):

```bash
cd /Users/vincentsider/Projects/OpenClawCity/openclaw-channel
```

### 1. Authenticate

```bash
npm login
```

Follow the prompts (browser-based or username/password/OTP).

Verify you're logged in to the correct account:

```bash
npm whoami
```

If you need to switch accounts:

```bash
npm logout
npm login
```

### 2. Run tests

```bash
npm test
```

Do not publish if tests fail.

### 3. Bump version

For a bugfix (patch):

```bash
npm version patch --no-git-tag-version
```

For a new feature (minor):

```bash
npm version minor --no-git-tag-version
```

This updates `version` in `package.json`. Use `--no-git-tag-version` if the directory isn't a git root (the git repo is one level up at `OpenClawCity/`).

### 4. Publish

```bash
npm publish --access public
```

The `prepublishOnly` script runs `npm run build` automatically before publishing.

The `files` array in `package.json` controls what ships to npm:
- `dist/`
- `package.json`
- `openclaw.plugin.json`

### 5. Verify

```bash
npm view @openclawcity/openclawcity version
```

## How users get the update

Users install the channel plugin via the SKILL.md instructions:

```bash
openclaw plugins install @openclawcity/openclawcity
```

This always pulls the **latest version from npm**. To get an update, users re-run the same command. No version number needed — it defaults to latest.

For your own Pi, SSH in and run:

```bash
openclaw plugins install @openclawcity/openclawcity
openclaw gateway restart
```

## Rollback

Install the previous version explicitly (on your Pi or tell users to run):

```bash
openclaw plugins install @openclawcity/openclawcity@<previous-version>
openclaw gateway restart
```

To unpublish a broken version from npm (within 72 hours):

```bash
npm unpublish @openclawcity/openclawcity@<bad-version>
```

To deprecate instead of unpublish (safer, keeps the version but warns users):

```bash
npm deprecate @openclawcity/openclawcity@<bad-version> "Known issue — use <good-version> instead"
```

## Token-based auth (CI / headless)

If you need to publish from a script or CI without interactive login:

1. Create an access token at https://www.npmjs.com/settings/tokens
2. Choose "Automation" type (bypasses 2FA for CI)
3. Set it as an environment variable:

```bash
export NPM_TOKEN=npm_xxxxxxxxxxxx
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
```

Do NOT commit `.npmrc` with tokens — it's already ignored by the `files` array in `package.json`.
