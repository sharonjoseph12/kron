import { describe, expect, it } from "vitest";
import { loadPaidResources } from "./resources.js";
import { parseRssItems } from "./data-providers.js";

describe("loadPaidResources", () => {
  it("loads the bundled resources.json catalog", () => {
    const resources = loadPaidResources();
    expect(resources["premium-market-report"]?.amountMicro).toBe("10000");
    expect(resources["premium-market-sentiment"]?.amountMicro).toBe("15000");
    expect(resources["premium-market-report"]?.note).toBe("kron:premium-market-report");
  });
});

describe("parseRssItems", () => {
  it("extracts titles and links from an RSS feed", () => {
    const xml = [
      "<rss><channel>",
      "<item><title>First Story</title><link>https://a.com/1</link></item>",
      "<item><title><![CDATA[Second &amp; Third]]></title><link>https://a.com/2</link></item>",
      "</channel></rss>",
    ].join("");
    const items = parseRssItems(xml, 5);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("First Story");
    expect(items[0]!.link).toBe("https://a.com/1");
    expect(items[1]!.title).toBe("Second & Third");
  });
});