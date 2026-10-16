# Privacy Policy — Visual SEO & Schema Suite

_Last updated: 2026-10-16_

**What runs locally.** Alt text, meta descriptions, audits, SVG minification and schema building run entirely inside the plugin in your browser. Your designs, images and page content are not sent to our servers.

**What we receive.** When metering is enabled, the plugin sends the license worker:
- a host user id (a hashed Framer user id, or a Webflow user/site id), which is stored only as a SHA-256 hash;
- the host name (`framer` or `webflow`) and the feature used;
- your license key, if you entered one. It is forwarded to Polar.sh for validation, and only a hash of it is cached for one hour.

Free-tier abuse protection keeps a hashed IP address counter for about 26 hours.

**Webflow CMS proxy.** CMS bulk updates send your Webflow site API token and CMS payloads through our proxy to `api.webflow.com`, because Webflow doesn't allow direct browser calls. Nothing is logged or stored.

**Optional AI providers.** If you add your own OpenAI or Anthropic API key, it is stored only in your browser's local storage. Image URLs and page context are sent directly from your browser to that provider, under the provider's own privacy terms.

**Payments.** Purchases and license keys are handled by Polar.sh.

**Contact.** Open an issue at https://github.com/chagaqi/visual-seo-schema-suite.
