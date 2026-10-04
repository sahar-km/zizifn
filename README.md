# $${\color{#3B82F6}\Huge Serverless \space Runtime}$$

> <br/>
>
> [<img src="https://img.shields.io/badge/Documentation-🇬🇧 English-silver" />][en]  
> [<img src="https://img.shields.io/badge/Documentation-🇮🇷 Persian-silver" />][fa]  
>
> <br/>

<br/>

<!--
$${\color{silver} We\space are\space \color{gray} All\space \color{red} REvil}$$

## $${\color{#94A3B8}\Large \text{Required Cloudflare Information}}$$
-->

### $${\color{#94A3B8}\Large Recent \space Changes}$$

> <details>
> <summary><b><i>Click here to see details</i></b></summary><br/>
> 
> - **Modular architecture**: worker logic split into `src/core.js`, `src/network.js`, `src/routes.js`, and `src/clash.js` instead of a single large file.
> 
> - **Safer WASM startup**: WASM is initialized once per isolate via a lazy singleton pattern, only when a WebSocket connection is opened. A failed initialization is retried on the next connection.
> 
> - **Self-contained config panel**: `index.html` is bundled at build time, no runtime fetch to GitHub Pages. The panel is decoded lazily on first request.
> 
> - **Faster proxy relay**: TCP response path uses `Uint8Array` instead of `Blob` for header concatenation.
> 
> - **Resilient fallback chain**: connections try `Direct → ProxyIP pool → NAT64`. Each stage is error-handled, so a failed ProxyIP moves on to the next one instead of dropping the connection.
> 
> - **NAT64 fallback**: as a last resort, the destination is resolved to IPv4 and routed through Cloudflare's NAT64 gateway. See [NAT64 Fallback](#color94a3b8large-nat64-space-fallback).
> 
> - **ProxyIP selection panel**: browse available ProxyIPs by country and risk score, and copy ready-made Xray / Singbox configs. See [ProxyIP Selection](#color94a3b8large-picking-space-aspace-proxyip).
> 
> - **Resilient IP lookups**: location and risk lookups use multiple providers with fallbacks, short upstream timeouts, and a `N/A` state when no risk score is available, instead of showing a misleading `0 / Low`.
> 
> - **Non-TLS configs for xray-enhanced**: added TCP (non-TLS) variants alongside TLS ones, for clients that support them like PattNG.
> 
> - **Native Clash Meta subscription**: added `/clash/<uuid>`, generating a full Clash Meta (mihomo) config directly from the worker — no external subconverter api service required.
> 
> - **Multi-account deploys**: the deploy workflow can deploy the same Worker to up to 4 separate Cloudflare accounts in one run, each ticked as a checkbox on the "Run workflow" form, with a separate worker name per account. See [Multi-Account Deployment](#color94a3b8large-multi-space-account-space-deployment).
> 
> - **Optional Gemini placement**: a workflow option pins the Worker to Google Cloud so Google AI Studio and Gemini stay reachable. See [Gemini & Google AI Studio](#color94a3b8large-google-space-ai-space-studio).
> 
> - **Workflow hardening**: least-privilege token permissions, concurrency control, validated worker names, and no user input interpolated directly into shell scripts.
> 
> </details>

<br/>

## $${\color{#94A3B8}\Large Setup}$$

_After forking this repository, you need to create a few GitHub repository secrets before running the workflow._

$${\color{silver}\large Go \space to:}$$

$${\color{#3B82F6}\Large Your \space Repository \space → \space Settings \space → \space}$$
$${\color{#3B82F6}\Large → \space Secrets \space and \space variables \space → \space actions}$$

$${\color{silver}\large Then \space click:}$$

$${\color{#3B82F6}\Large New \space repository \space secret}$$

$${\color{silver}\large and \space add \space the \space following \space variables.}$$ 


| **Secret Name** | **Required** | **Default** | **Description** |
| ------ | :-----: | :------: | :-------------- |
| `CLOUDFLARE_API_TOKEN` | ✔️Yes | -  | Your Cloudflare Account API Token, for account slot 1. It **must** have permission to **Edit Workers**. |
| `CLOUDFLARE_ACCOUNT_ID` | ✔️Yes | - | Your Cloudflare Account ID, for account slot 1. |
| `UUID` | Recommended | `be0ff9df-1468-41a0-8865-796d1c6800db` | Your own [Version 4 UUID][1]. If not set, a manual run generates a random one, while a push to `main` falls back to the **public** default UUID shown here. Always set your own. |
| `PROXYIP` | Optional | `di.nscl.ir` | Optional proxy IP or hostname. If omitted, the default value will be used. [ProxyIP tools][2] |
| `WORKERNAME` | Optional | name in `wrangler.toml` | Worker name for slot 1. Lowercase letters, digits and hyphens only. |
| `ENABLE_GEMINI` | Optional | `false` | Set to `true` to always apply the [Gemini placement](#color94a3b8large-google-space-ai-space-studio). |

![rain]

<br/>

### $${\color{#94A3B8}\Large Required \space Information}$$

_The following two secrets are **required** and must be obtained from your own [Cloudflare account][3]_

- _`CLOUDFLARE_API_TOKEN`_
- _`CLOUDFLARE_ACCOUNT_ID`_

> [_**More details**_][4]

<br/>

> [!NOTE]
> 
> The API Token must include permission to **Edit Workers**. Otherwise, the deployment workflow will fail.  
>  
> Once these secrets have been added, the GitHub Actions workflow is ready to deploy.

> [!IMPORTANT]
> This repository is public, and the default UUID is visible to everyone. If you deploy without your own `UUID` secret, anyone can open your panel and use your Worker. The workflow prints a warning in the run log when the fallback UUID is used.

<br/>

## $${\color{#94A3B8}\Large Accessing \space the \space Panel}$$

After a deployment, open:

```text
https://<your-worker>.<your-subdomain>.workers.dev/<UUID>
```

The UUID is masked in the public run summary. To read it, open the Cloudflare Dashboard → Workers & Pages → your worker → Settings → Variables and Secrets.

If you open the Worker without a UUID in the path, you get a 404 page that explains this and links to your worker's settings.

<br/>

## $${\color{#94A3B8}\Large Endpoints}$$

| **Variable** | **Description** |
| :----- | :----- |
| `UUID` | User ID accepted by the Worker. |
| `PROXYIP` | Primary ProxyIP. Tried first, before the built-in ProxyIPs. |
| `WORKERNAME` | Worker name, used for the dashboard link in the panel. |
| `NAT64` | Set to `off` to disable the NAT64 fallback globally. Enabled by default. |

These are set automatically by the deploy workflow.

<br/>

## $${\color{#94A3B8}\Large Runtime \space Variables}$$

| **Variable** | **Description** |
| :----- | :----- |
| `UUID` | User ID accepted by the Worker. |
| `PROXYIP` | Primary ProxyIP. Tried first, before the built-in ProxyIPs. |
| `WORKERNAME` | Worker name, used for the dashboard link in the panel. |
| `NAT64` | Set to `off` to disable the NAT64 fallback globally. Enabled by default. |

These are set automatically by the deploy workflow.

<br/>

## $${\color{#94A3B8}\Large NAT64 \space Fallback}$$

**Connection order:**

```text
Direct connection → ProxyIP pool → NAT64
```

If the direct connection and every ProxyIP fail to return data, the Worker resolves the destination to IPv4, embeds it into a `64:ff9b::/96` address, and connects through Cloudflare's NAT64 gateway.

- Enabled by default. Disable it globally with `NAT64=off`.
- Override per config with a path query: `?nat64=on` or `?nat64=off`.
- The panel has a NAT64 card with an on/off switch and a copy button, and subscriptions include one NAT64 config.

<br/>

## $${\color{#94A3B8}\Large Picking \space a\space ProxyIP}$$

The panel's **ProxyIPs** card lists the available ProxyIPs grouped by country, with a risk score for each IP.

1. Pick a country.
2. Tick one or more endpoints.
3. Copy the Xray or Singbox config. Each config carries `?proxyip=IP:PORT`, which makes that endpoint the fallback route for that connection only.

Subscriptions also include the lowest-risk ProxyIP configs, tagged by country, host type and index, for example `🇺🇸US-Domain-1`.

Lookup results are cached for 6 hours using the Cache API, and the Refresh button bypasses that cache. Cache API storage is not available on `*.workers.dev` domains, so results are fetched again on every request there.

<br/>

## $${\color{#94A3B8}\Large Multi \space Account \space Deployment}$$

_This Worker can be deployed to up to 4 separate Cloudflare accounts from the same run._

On the **Run workflow** form (Actions tab → Deploy Worker → Run workflow), the first four fields are checkboxes — one per account "slot" — labelled `Deploy to Account 1` through `Deploy to Account 4`. Tick every slot you want deployed; each ticked slot deploys in parallel, using that slot's own secrets. You can rename these checkbox labels in the workflow file to your own account names (e.g. "Deploy to Personal", "Deploy to Client A").

A plain `git push` to `main` (no form filled in) always deploys to slot 1 only, same as a single-account setup.

**Slot 1 uses the plain, unsuffixed secret names** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, ...) — exactly like a normal single-account setup, so nothing changes for slot 1 if you're only deploying to one account. **Slots 2 and up use the same names with a `_N` suffix**, where `N` is the slot number:

| **Slot** | **Secret (required)** | **Secret / Variable (optional)** |
| :--: | :---- | :---- |
| 1 | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `UUID`, `PROXYIP`, `WORKERNAME`, `CLOUDFLARE_ACCOUNT_LABEL` (variable) |
| 2 | `CLOUDFLARE_API_TOKEN_2`, `CLOUDFLARE_ACCOUNT_ID_2` | `UUID_2`, `PROXYIP_2`, `WORKERNAME_2`, `CLOUDFLARE_ACCOUNT_2_LABEL` (variable) |
| 3 | `CLOUDFLARE_API_TOKEN_3`, `CLOUDFLARE_ACCOUNT_ID_3` | `UUID_3`, `PROXYIP_3`, `WORKERNAME_3`, `CLOUDFLARE_ACCOUNT_3_LABEL` (variable) |
| 4 | `CLOUDFLARE_API_TOKEN_4`, `CLOUDFLARE_ACCOUNT_ID_4` | `UUID_4`, `PROXYIP_4`, `WORKERNAME_4`, `CLOUDFLARE_ACCOUNT_4_LABEL` (variable) |

A slot that isn't ticked is skipped. If you tick a slot whose required secrets were never set, the run fails for that slot with a clear error, while the other slots still deploy. Only slot 1 needs to be configured for a normal single-account setup.

`CLOUDFLARE_ACCOUNT_LABEL` / `CLOUDFLARE_ACCOUNT_N_LABEL` is a repository **Variable**, not a Secret (Settings → Secrets and variables → Actions → **Variables** tab), since it's just a human-readable name — e.g. `Personal`, `Client-A` — shown in the deploy step name and the run summary. It defaults to `Account N` if left unset.

<br/>

### $${\color{#94A3B8}\Large Run \space Workflow \space Inputs}$$

| **Input** | **Description** |
| :----- | :----- |
| `account_1` … `account_4` | Checkboxes that choose which accounts to deploy to. |
| `workernames` | Worker names in slot order, comma-separated. Leave a slot empty to use the default for it. |
| `proxyip` | ProxyIP for this run. Applies to every ticked account. |
| `uuid` | UUID for this run. Applies to every ticked account. Leave blank to use secrets, or a random one. |
| `enable_gemini` | Apply the [Gemini placement](#color94a3b8large-google-space-ai-space-studio) for this run. |

<br/>

### $${\color{#94A3B8}\Large Value \space Priority}$$

When the same setting can come from several places, the first match wins:

| **Setting** | **Order** |
| :----- | :----- |
| Worker name | `workernames` input (slot position) → `WORKERNAME` / `WORKERNAME_N` secret → `name` in `wrangler.toml` |
| UUID | `uuid` input → `UUID_N` secret → `UUID` secret → random UUID (manual run) or public default (push) |
| ProxyIP | `proxyip` input → `PROXYIP_N` secret → `PROXYIP` secret → `di.nscl.ir` |

**Worker names example:** to deploy slots 1 and 3 as `alpha` and `gamma`, tick both and enter:

```text
alpha,,gamma
```

An empty position falls back to the secret or `wrangler.toml` name. Names must be lowercase letters, digits and hyphens only.

> [!NOTE]
> 
> Changing a worker's name creates a **new** Worker with a new `workers.dev` address. The old Worker stays in your dashboard until you delete it.

To add a 5th (or further) account slot, copy one `account_N` block in the workflow's `workflow_dispatch` inputs, bump every `N` in it, add a matching `SEL_N` line and `add N` check in the **Build account matrix** step, and add that account's two required secrets (as `CLOUDFLARE_API_TOKEN_N` / `CLOUDFLARE_ACCOUNT_ID_N` — the unsuffixed names are reserved for slot 1).

<br/>

### $${\color{#94A3B8}\Large To \space add \space a \space new \space Cloudflare \space account:}$$

1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**.
2. Add `CLOUDFLARE_API_TOKEN_N` and `CLOUDFLARE_ACCOUNT_ID_N` as new **Secrets**, where `N` is the next free slot number (`2`, `3`, `4`, ...) — slot 1 uses the plain, unsuffixed names instead.
3. _(Optional)_ Add `CLOUDFLARE_ACCOUNT_N_LABEL` as a new **Variable** with a friendly name for that account.
4. _(Optional)_ Add `UUID_N`, `PROXYIP_N`, `WORKERNAME_N` if this account should use different values than the shared/default ones.
5. On the next manual run, tick that account's checkbox on the "Run workflow" form.

<br/>

### $${\color{#94A3B8}\Large Google \space AI \space Studio}$$

By default, a Worker runs close to the visitor, and from some locations [Gemini][5] / [Google AI Studio][6] / [Jules][7] do not open through it. Enabling **Gemini placement** adds this to `wrangler.toml` at deploy time:

```toml
[placement]
region = "gcp:us-central1"
```

Turn it on by ticking `enable_gemini` on the Run workflow form, or by setting the `ENABLE_GEMINI` secret to `true`.

> [!NOTE]
> 
> With this option the Worker runs in a Google Cloud region in the US instead of the default location, so latency may be slightly higher. Leave it off if you don't need Google AI services.

<br/>

## $${\color{#94A3B8}\Large Troubleshooting}$$

| **Problem** | **What to check** |
| :---------- | :---------------- |
| `No Cloudflare account selected` | Tick at least one account checkbox on the Run workflow form. |
| `Account #N is selected but its secrets aren't set` | Add `CLOUDFLARE_API_TOKEN_N` and `CLOUDFLARE_ACCOUNT_ID_N`. |
| `Invalid worker name` | Use lowercase letters, digits and hyphens only. |
| Run log shows a UUID fallback warning | Set your own `UUID` secret. |
| `404` page saying no UUID was found | Open `https://<worker-host>/<UUID>`. |
| Cloudflare error `1101` | The Worker threw an exception. Open the Worker's **Logs** in the Cloudflare Dashboard, or run `wrangler tail`, and read the stack trace. |
| Risk score shows `N/A` | The risk-score API did not respond. The panel keeps working, and the value is retried after a short cache period. |

<br/>

## $${\color{#94A3B8}\Large Project \space Structure}$$


```text
Directory structure:
└── nirevil-zizifn/
    ├── index.js                    Worker entry point and routing
    ├── index.html                  Config panel, bundled at build time
    ├── wrangler.toml               Worker configuration
    ├── Cargo.toml                  Rust / WASM crate
    ├── src/
    │   ├── core.js                 Config, link building, caching, shared helpers
    │   ├── network.js              WebSocket relay, ProxyIP and NAT64 fallback
    │   ├── routes.js               Panel, subscriptions and API routes
    │   ├──  clash.js                Clash Meta config generator
    │   └──  lib.rs                  Rust / WASM protocol header parser
    └── .github/
        └── workflows/
            └── deploy.yml          Multi-account deploy workflow
```

---

<!--
> <br/>
>
> <p><b>🪶 Credits</b></p>
>
> [<img src="https://img.shields.io/badge/Founder_%26_Owner-NiREvil-966600" />](https://github.com/NiREvil)  
> [<img src="https://img.shields.io/badge/Scamalytics_Risk_Score-Mehdi_Hexing-966600" />](https://github.com/mehdi-hexing/Cloudflare-Scamalytics)  
> [<img src="https://img.shields.io/badge/Development_%26_Maintenance-Diana--Cl-966600" />](https://github.com/Diana-Cl)  
>
> <br/>
-->

[1]: https://www.uuidgenerator.net
[2]: https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md
[3]: https://dash.cloudflare.com/?to=/:account/api-tokens/create
[4]: https://diana-cl.github.io/Diana-Cl/en/topics/zizifn#token-time
[5]: https://gemini.google.com
[6]: https://aistudio.google.com
[7]: https://jules.google
[fa]: https://diana-cl.github.io/Diana-Cl/topics/zizifn
[en]: https://diana-cl.github.io/Diana-Cl/en/topics/zizifn
[rain]: https://github.com/NiREvil/vless/assets/126243832/1aca7f5d-6495-44b7-aced-072bae52f256
[zizifn]: https://github.com/zizifn/edgetunnel 
[NiREvil]: https://github.com/NiREvil
[PattNG]: https://github.com/patterniha/v2rayNG/releases
