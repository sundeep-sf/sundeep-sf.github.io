const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const siteBasePath = "";
const routes = [
  `${siteBasePath}/notes/`,
  `${siteBasePath}/notes/outliney/`,
  `${siteBasePath}/notes/coding-agents-101/`,
];

let baseUrl;
let browser;
let server;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const repositoryPathname = pathname.startsWith(`${siteBasePath}/`)
      ? pathname.slice(siteBasePath.length)
      : pathname;
    const relativePath = repositoryPathname.endsWith("/")
      ? `${repositoryPathname}index.html`
      : repositoryPathname;
    const filePath = path.resolve(root, `.${relativePath}`);

    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
      response.writeHead(404).end("Not found");
      return;
    }

    const contentType = filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".js")
        ? "text/javascript"
        : "text/html";

    response.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` });
    fs.createReadStream(filePath).pipe(response);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
  });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test("every notes page uses the shared shell and links to the notes home", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let sharedAppearance;

  for (const route of routes) {
    await page.goto(`${baseUrl}${route}`);

    assert.equal(await page.locator("link[href$='assets/site.css']").count(), 1, route);
    assert.equal(await page.locator("script[src$='assets/outline.js']").count(), 1, route);
    assert.equal(await page.locator("header.site-header").count(), 1, route);

    const notesLink = page.getByRole("navigation", { name: "Notes" }).getByRole("link", { name: "Notes" });
    const notesHref = await notesLink.getAttribute("href");
    assert.equal(new URL(notesHref, `${baseUrl}${route}`).pathname, `${siteBasePath}/notes/`, route);

    const appearance = await page.locator("body").evaluate((body) => {
      const bodyStyle = getComputedStyle(body);
      const titleStyle = getComputedStyle(document.querySelector("h1"));
      return {
        backgroundColor: bodyStyle.backgroundColor,
        fontFamily: bodyStyle.fontFamily,
        maxWidth: bodyStyle.maxWidth,
        titleSize: titleStyle.fontSize,
      };
    });

    sharedAppearance ??= appearance;
    assert.deepEqual(appearance, sharedAppearance, route);
    assert.equal(appearance.backgroundColor, "rgb(250, 250, 250)", route);
    assert.match(appearance.fontFamily, /-apple-system/, route);
    assert.equal(appearance.maxWidth, "720px", route);
    assert.equal(appearance.titleSize, "28px", route);
  }

  await page.goto(`${baseUrl}${siteBasePath}/notes/outliney/`);
  await page.getByRole("navigation", { name: "Notes" }).getByRole("link", { name: "Notes" }).click();
  assert.equal(new URL(page.url()).pathname, `${siteBasePath}/notes/`);

  await page.close();
});

test("a reader starts in Outline and can switch to Normal", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}${siteBasePath}/notes/coding-agents-101/`);

  assert.equal(await page.getByRole("button", { name: "Outline" }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("[data-view-panel='outline']").isVisible(), true);
  assert.equal(await page.locator("[data-view-panel='normal']").isVisible(), false);
  assert.equal(await page.locator("[data-outline-controls]").isVisible(), true);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Normal" }).click();

  assert.equal(new URL(page.url()).searchParams.get("view"), "normal");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(await page.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("[data-view-panel='normal']").isVisible(), true);
  assert.equal(await page.locator("[data-view-panel='outline']").isVisible(), false);
  assert.equal(await page.locator("[data-outline-controls]").isVisible(), false);
  assert.equal(await page.locator("[data-view-panel='normal'] .section-heading").count(), 0);

  await context.close();
});

test("view URLs and the saved preference control navigation", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${baseUrl}${siteBasePath}/notes/`);
  assert.equal(new URL(page.url()).searchParams.get("view"), "outline");

  await page.getByRole("button", { name: "Normal" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("notes-view")), "normal");

  await page.goto(`${baseUrl}${siteBasePath}/notes/outliney/`);
  assert.equal(new URL(page.url()).searchParams.get("view"), "normal");
  assert.equal(await page.locator("[data-view-panel='normal']").isVisible(), true);

  await page.goto(`${baseUrl}${siteBasePath}/notes/outliney/?view=outline`);
  assert.equal(await page.locator("[data-view-panel='outline']").isVisible(), true);

  await page.goto(`${baseUrl}${siteBasePath}/notes/?view=unknown`);
  assert.equal(new URL(page.url()).searchParams.get("view"), "normal");

  await page.goto(`${baseUrl}${siteBasePath}/notes/?view=outline`);
  const outlineyLink = page.getByRole("link", { name: /Outliney/ });
  assert.equal(new URL(await outlineyLink.getAttribute("href")).searchParams.get("view"), "outline");
  await outlineyLink.click();
  assert.equal(new URL(page.url()).pathname, `${siteBasePath}/notes/outliney/`);
  assert.equal(new URL(page.url()).searchParams.get("view"), "outline");

  await context.close();
});

test("the Links control applies independently in both views", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}${siteBasePath}/notes/coding-agents-101/?view=normal`);

  const linkToggle = page.getByRole("checkbox", { name: "Links" });
  const normalExternalLink = page.locator("[data-view-panel='normal'] a[href^='http']").first();
  const outlineExternalLink = page.locator("[data-view-panel='outline'] a[href^='http']").first();

  assert.equal(await linkToggle.isChecked(), true);
  await page.getByText("Links", { exact: true }).click();
  assert.equal(await linkToggle.isChecked(), false);
  assert.equal(await normalExternalLink.evaluate((link) => getComputedStyle(link).pointerEvents), "none");

  await page.getByRole("button", { name: "Outline" }).click();
  assert.equal(await outlineExternalLink.evaluate((link) => getComputedStyle(link).pointerEvents), "none");

  await page.getByText("Links", { exact: true }).click();
  assert.equal(await linkToggle.isChecked(), true);
  assert.equal(await outlineExternalLink.evaluate((link) => getComputedStyle(link).pointerEvents), "auto");

  await context.close();
});

test("the expanded outline remains readable without JavaScript", async () => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}${siteBasePath}/notes/coding-agents-101/?view=normal`);

  assert.equal(await page.locator("[data-view-panel='outline']").isVisible(), true);
  assert.equal(await page.locator("[data-view-panel='normal']").isVisible(), false);
  assert.equal(await page.locator("[data-outline-controls]").isVisible(), false);
  assert.equal(await page.locator(".view-switch").isVisible(), false);
  assert.equal(await page.getByRole("heading", { name: "References" }).isVisible(), true);

  await context.close();
});

test("every notes page provides accessible outline controls", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${baseUrl}${siteBasePath}/notes/`);
  assert.equal(await page.getByRole("heading", { name: "Sundeep's Notes" }).count(), 1);
  assert.equal(await page.locator("#toggle-all").count(), 0);
  assert.equal(await page.locator(".section-heading[role='button']").count(), 1);

  for (const route of routes.slice(1)) {
    await page.goto(`${baseUrl}${route}`);

    const headings = page.locator(".section-heading[role='button']");
    const topLevelHeadings = page.locator(".section[data-outline-depth='1'] > .section-heading");
    const nestedHeadings = page.locator(".section:not([data-outline-depth='1']) > .section-heading");
    assert.ok(await headings.count(), route);
    assert.equal(
      await topLevelHeadings.evaluateAll((elements) => elements.every((element) => element.getAttribute("aria-expanded") === "true")),
      true,
      route,
    );
    assert.equal(
      await nestedHeadings.evaluateAll((elements) => elements.every((element) => element.getAttribute("aria-expanded") === "false")),
      true,
      route,
    );

    const toggleAllButton = page.locator("#toggle-all");
    assert.equal(await toggleAllButton.textContent(), "Expand all", route);

    const firstHeading = headings.first();
    const controlledContent = page.locator(`#${await firstHeading.getAttribute("aria-controls")}`);

    assert.equal(await firstHeading.getAttribute("aria-expanded"), "true", route);
    assert.equal(await controlledContent.getAttribute("aria-hidden"), "false", route);

    await firstHeading.press("Enter");
    assert.equal(await firstHeading.getAttribute("aria-expanded"), "false", route);
    assert.equal(await controlledContent.getAttribute("aria-hidden"), "true", route);
    assert.equal(await controlledContent.getAttribute("inert"), "", route);

    await firstHeading.press("Space");
    assert.equal(await firstHeading.getAttribute("aria-expanded"), "true", route);
    assert.equal(await controlledContent.getAttribute("aria-hidden"), "false", route);
    assert.equal(await controlledContent.getAttribute("inert"), null, route);

    await page.reload();
    assert.equal(await toggleAllButton.textContent(), "Expand all", route);
    await toggleAllButton.click();
    assert.equal(await page.locator(".section-heading[aria-expanded='true']").count(), await headings.count(), route);
    assert.equal(await toggleAllButton.textContent(), "Collapse all", route);

    await toggleAllButton.click();
    assert.equal(await page.locator(".section-heading[aria-expanded='false']").count(), await headings.count(), route);
    assert.equal(await toggleAllButton.textContent(), "Expand all", route);
  }

  await page.close();
});

test("every notes page keeps the shared layout on a small screen", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });

  for (const route of routes) {
    for (const view of ["normal", "outline"]) {
      await page.goto(`${baseUrl}${route}?view=${view}`);

      const layout = await page.locator("body").evaluate((body) => ({
        fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
        headerDirection: getComputedStyle(body.querySelector(".header-top")).flexDirection,
        titleSize: getComputedStyle(body.querySelector("h1")).fontSize,
      }));

      assert.deepEqual(layout, {
        fitsViewport: true,
        headerDirection: "column",
        titleSize: "24px",
      }, `${route}?view=${view}`);
    }
  }

  await page.close();
});
