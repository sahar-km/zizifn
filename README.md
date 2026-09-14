# $${\color{#3B82F6}\Huge Serverless \space Runtime}$$

***[⁠■ Persian Documentation][fa]***  
***[⁠■ English Documentation][en]***

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
> - **Safer WASM startup**: WASM is initialized once per isolate via a lazy singleton pattern, only when a WebSocket connection is opened.
> 
> - **Self-contained config panel**: `index.html` is bundled at build time, no runtime fetch to GitHub Pages.
> 
> - **Faster proxy relay**: TCP response path uses `Uint8Array` instead of `Blob` for header concatenation.
> 
> - **Resilient ProxyIP fallback**: multiple ProxyIP domains are tried in sequence if the primary one is unreachable.
> 
> - **Non-TLS configs for xray-enhanced**: added TCP (non-TLS) variants alongside TLS ones, for clients that support them like PattNG.
> 
> - **Native Clash Meta subscription**: added `/clash/<uuid>`, generating a full Clash Meta (mihomo) config directly from the worker — no external subconverter api service required.
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
| `CLOUDFLARE_API_TOKEN` | ✔️Yes | -  | Your Cloudflare Account API Token. It **must** have permission to **Edit Workers**. |
| `CLOUDFLARE_ACCOUNT_ID` | ✔️Yes | - | Your Cloudflare Account ID. |
| `UUID` | Optional | `be0ff9df-1468-41a0-8865-796d1c6800db` | Your own [Version 4 UUID][1]. If not provided, the workflow will automatically generate a random one. |
| `PROXYIP` | Optional | `di.nscl.ir` | Optional proxy IP or hostname. If omitted, the default value will be used. [ProxyIP tools][2] |

![rain]

<br/>

### $${\color{#94A3B8}\Large Required \space Information}$$

_The following two secrets are **required** and must be obtained from your own [Cloudflare account][3]_

- _`CLOUDFLARE_API_TOKEN`_
- _`CLOUDFLARE_ACCOUNT_ID`_

> [_**More details**_][4]

<br/>

### $${\color{#94A3B8}\Large Note}$$

> The API Token must include permission to **Edit Workers**. Otherwise, the deployment workflow will fail.  
>  
> Once these secrets have been added, the GitHub Actions workflow is ready to deploy.

[1]: https://www.uuidgenerator.net
[2]: https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md
[3]: https://dash.cloudflare.com/?to=/:account/api-tokens/create
[4]: https://diana-cl.github.io/Diana-Cl/en/topics/zizifn#token-time
[fa]: https://diana-cl.github.io/Diana-Cl/topics/zizifn
[en]: https://diana-cl.github.io/Diana-Cl/en/topics/zizifn
[rain]: https://github.com/NiREvil/vless/assets/126243832/1aca7f5d-6495-44b7-aced-072bae52f256
