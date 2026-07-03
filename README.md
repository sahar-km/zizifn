# Setup

After forking this repository, you need to create a few GitHub repository secrets before running the workflow.

Go to:

**Repository → Settings → Secrets and variables → Actions**

Then click **New repository secret** and add the following variables.

| Secret Name | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `CLOUDFLARE_API_TOKEN` | ✔️Yes | - | Your Cloudflare API Token. It **must** have permission to **Edit Workers**. |
| `CLOUDFLARE_ACCOUNT_ID` | ✔️Yes | - | Your Cloudflare Account ID. |
| `UUID` | Optional | `be0ff9df-1468-41a0-8865-796d1c6800db` | Your own [version4 UUID][1]. If not provided, the workflow will automatically use the default value. |
| `PROXYIP` | Optional | `nima.nscl.ir` | Optional proxy IP or hostname. If omitted, the default value will be used. |

## Required Cloudflare Information

The following two secrets are **required** and must be obtained from your own Cloudflare account:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

> **Note**
>
> The API Token must include permission to **Edit Workers**. Otherwise, the deployment workflow will fail.

Once these secrets have been added, the GitHub Actions workflow is ready to deploy.

[1]: https://www.uuidgenerator.net
